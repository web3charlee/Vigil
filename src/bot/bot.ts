import { Bot, GrammyError, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { BRAND, TAGLINE } from '../brand.js';
import { CHAINS } from '../chains.js';
import { TokenNotFoundError, UpstreamError } from '../errors.js';
import { scanToken, type ScanInput } from '../scanner/index.js';
import type { ScanResult } from '../types.js';
import { escapeHtml, extractAddress, TtlCache } from '../util.js';
import { formatScan, scanKeyboard, settingsKeyboard } from './format.js';
import type { RateLimiter } from './limiter.js';
import type { UserStore } from './store.js';

export interface BotDeps {
  token: string;
  store: UserStore;
  limiter: RateLimiter;
  adminId?: number;
  botInfo?: UserFromGetMe; // lets tests skip the getMe network call
  scan?: (input: ScanInput) => Promise<ScanResult>;
}

const NOT_MODIFIED = 'message is not modified';

export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  const { store, limiter } = deps;
  const cache = new TtlCache<ScanResult>(60_000);
  const scan =
    deps.scan ?? ((input: ScanInput) => scanToken(input, { cache, log: (m) => console.warn(m) }));

  const html = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

  function errorText(e: unknown): string {
    if (e instanceof TokenNotFoundError) {
      return "Couldn't find a trading pair for that address. Check it's a token (not a wallet) and that it has a live pool.";
    }
    if (e instanceof UpstreamError) return 'A data provider is not responding right now. Try again in a moment.';
    console.error(e);
    return 'Something went wrong on my side. Try again.';
  }

  async function runScan(ctx: Context, input: ScanInput, editInPlace: boolean): Promise<void> {
    const uid = ctx.from?.id;
    if (!uid) return;
    const gate = limiter.check(uid);
    if (!gate.ok) {
      const msg = `Slow down, try again in ${gate.retryInSec}s.`;
      if (editInPlace) await ctx.answerCallbackQuery({ text: msg });
      else await ctx.reply(msg);
      return;
    }

    let placeholderId: number | undefined;
    if (!editInPlace) {
      const m = await ctx.reply('🔍 Scanning…');
      placeholderId = m.message_id;
    }

    try {
      const result = await scan(input);
      store.incrementScans(uid);
      const text = formatScan(result, { maxRisk: store.get(uid).maxRisk });
      const kb = scanKeyboard(result, ctx.me.username);
      if (editInPlace) {
        await ctx.editMessageText(text, { ...html, reply_markup: kb });
      } else if (ctx.chat && placeholderId) {
        await ctx.api.editMessageText(ctx.chat.id, placeholderId, text, { ...html, reply_markup: kb });
      }
    } catch (e) {
      if (e instanceof GrammyError && e.description.includes(NOT_MODIFIED)) return;
      const msg = errorText(e);
      if (editInPlace) await ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => {});
      else if (ctx.chat && placeholderId) await ctx.api.editMessageText(ctx.chat.id, placeholderId, msg);
      else await ctx.reply(msg);
    }
  }

  // ---------- commands ----------
  bot.command('start', async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const m = /^ref_(\d+)$/.exec(ctx.match ?? '');
    store.registerStart(uid, m?.[1] ? Number(m[1]) : null);
    await ctx.reply(
      [
        `<b>${escapeHtml(BRAND)}</b>: ${escapeHtml(TAGLINE)}`,
        '',
        'Send me a contract address on any supported chain and I will check honeypots, taxes, liquidity, holders and more in seconds.',
        '',
        '/settings: set your risk limit',
        '/chains: supported chains',
        '/ref: your invite link',
        'Add me to a group and use /scan &lt;address&gt; there.',
      ]
        .join('\n'),
      html,
    );
  });

  bot.command('help', (ctx) =>
    ctx.reply(
      'Paste a token contract address (EVM or Solana) and I will scan it. In groups, use /scan <address>.\n\n/settings /chains /ref',
    ),
  );

  bot.command('chains', (ctx) =>
    ctx.reply(`Supported chains:\n${CHAINS.map((c) => `• ${c.name}${c.goplusId ? '' : ' (market data only)'}`).join('\n')}`),
  );

  bot.command('scan', async (ctx) => {
    const found = extractAddress(ctx.match ?? '');
    if (!found) {
      await ctx.reply('Usage: /scan <contract address>');
      return;
    }
    await runScan(ctx, found, false);
  });

  bot.command('settings', async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const cur = store.get(uid).maxRisk;
    await ctx.reply(
      `<b>Risk limit: ${cur}</b>\nTokens scoring at or above this are flagged as blocked. Lower = stricter.`,
      { ...html, reply_markup: settingsKeyboard(cur) },
    );
  });

  bot.command('ref', async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    store.get(uid);
    await ctx.reply(
      `Your invite link:\nhttps://t.me/${ctx.me.username}?start=ref_${uid}\n\nInvited so far: ${store.referralCount(uid)}`,
    );
  });

  bot.command('stats', async (ctx) => {
    if (!deps.adminId || ctx.from?.id !== deps.adminId) return;
    const s = store.stats();
    await ctx.reply(`Users: ${s.users}\nScans: ${s.scans}\nReferred users: ${s.referred}`);
  });

  // ---------- plain messages: auto-scan in private chats only ----------
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (ctx.message.text.startsWith('/')) return;
    const found = extractAddress(ctx.message.text);
    if (!found) {
      await ctx.reply('Send me a token contract address to scan.');
      return;
    }
    await runScan(ctx, found, false);
  });

  // ---------- buttons ----------
  bot.callbackQuery(/^([rs]):([a-z0-9]+):(\S+)$/, async (ctx) => {
    const [, action, chain, address] = ctx.match as unknown as [string, string, string, string];
    const found = extractAddress(address);
    if (!found) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery().catch(() => {});
    await runScan(
      ctx,
      { ...found, preferChain: chain, fresh: action === 'r' },
      true,
    );
  });

  bot.callbackQuery(/^set:risk:(\d{1,3})$/, async (ctx) => {
    const uid = ctx.from.id;
    const n = Number((ctx.match as unknown as string[])[1]);
    store.setMaxRisk(uid, n);
    await ctx.answerCallbackQuery({ text: `Risk limit set to ${n}` });
    try {
      await ctx.editMessageText(
        `<b>Risk limit: ${n}</b>\nTokens scoring at or above this are flagged as blocked. Lower = stricter.`,
        { ...html, reply_markup: settingsKeyboard(n) },
      );
    } catch (e) {
      if (!(e instanceof GrammyError && e.description.includes(NOT_MODIFIED))) throw e;
    }
  });

  bot.catch((err) => {
    console.error(`Bot error (update ${err.ctx.update.update_id}):`, err.error);
  });

  return bot;
}

