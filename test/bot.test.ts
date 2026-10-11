import { describe, expect, it } from 'vitest';
import { createBot } from '../src/bot/bot.js';
import { RateLimiter } from '../src/bot/limiter.js';
import { UserStore } from '../src/bot/store.js';
import { CHAIN_BY_KEY } from '../src/chains.js';
import { TokenNotFoundError } from '../src/errors.js';
import { evaluate } from '../src/scanner/risk.js';
import type { ScanResult } from '../src/types.js';
import { cleanSafety, market, NOW } from './fixtures.js';

const ADDR = '0x1111111111111111111111111111111111111111';
const botInfo = {
  id: 42, is_bot: true as const, first_name: 'Vigil', username: 'vigil_bot',
  can_join_groups: true as const, can_read_all_group_messages: false as const, supports_inline_queries: false as const,
  can_connect_to_business: false as const, has_main_web_app: false as const,
  has_topics_enabled: false as const, allows_users_to_create_topics: false as const,
  can_manage_bots: false as const, supports_join_request_queries: false as const,
};

const okScan = async (): Promise<ScanResult> => ({
  chain: CHAIN_BY_KEY.get('base')!,
  market: market(),
  safety: cleanSafety(),
  report: evaluate(market(), cleanSafety(), NOW),
  otherChains: [{ chainKey: 'bsc', liquidityUsd: 1000 }],
});

type Call = { method: string; payload: Record<string, any> };

function harness(over: { scan?: () => Promise<ScanResult>; limit?: number; adminId?: number } = {}) {
  const store = new UserStore(null);
  const bot = createBot({
    token: '123:abc',
    store,
    limiter: new RateLimiter(over.limit ?? 10),
    scan: over.scan ?? okScan,
    adminId: over.adminId,
    botInfo,
  });
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    if (method === 'sendMessage') return { ok: true, result: { message_id: 99, date: 0, chat: { id: 1, type: 'private' }, text: '' } } as any;
    return { ok: true, result: true } as any;
  });
  return { bot, store, calls };
}

const from = { id: 1, is_bot: false, first_name: 'Tester' };
let uid = 1;
const msg = (text: string, chatType: 'private' | 'group' = 'private', userId = 1) => {
  const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] : undefined;
  return {
    update_id: uid++,
    message: {
      message_id: uid, date: 0, text, entities,
      chat: chatType === 'private' ? { id: userId, type: 'private', first_name: 'T' } : { id: -100, type: 'group', title: 'g' },
      from: { ...from, id: userId },
    },
  } as any;
};
const cb = (data: string, userId = 1) =>
  ({
    update_id: uid++,
    callback_query: {
      id: 'cb1', chat_instance: 'x', data, from: { ...from, id: userId },
      message: { message_id: 7, date: 0, chat: { id: userId, type: 'private', first_name: 'T' }, text: 'old' },
    },
  }) as any;

describe('bot wiring', () => {
  it('auto-scans a pasted address in a private chat and edits the placeholder with the card', async () => {
    const { bot, calls, store } = harness();
    await bot.handleUpdate(msg(`look at ${ADDR}`));
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'editMessageText']);
    const edit = calls[1]!.payload;
    expect(edit.message_id).toBe(99);
    expect(edit.text).toContain('<b>TEST</b>');
    expect(edit.parse_mode).toBe('HTML');
    const buttons = edit.reply_markup.inline_keyboard.flat();
    expect(buttons.some((b: any) => b.callback_data === `r:base:${market().address}`)).toBe(true);
    expect(buttons.some((b: any) => b.callback_data?.startsWith('s:bsc:'))).toBe(true);
    expect(store.get(1).scans).toBe(1);
  });

  it('ignores plain addresses in groups but answers /scan there', async () => {
    const { bot, calls } = harness();
    await bot.handleUpdate(msg(ADDR, 'group'));
    expect(calls).toHaveLength(0);
    await bot.handleUpdate(msg(`/scan ${ADDR}`, 'group'));
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'editMessageText']);
  });

  it('asks for an address when /scan has none', async () => {
    const { bot, calls } = harness();
    await bot.handleUpdate(msg('/scan'));
    expect(calls[0]!.payload.text).toContain('Usage');
  });

  it('tells the user when a token has no pairs', async () => {
    const { bot, calls } = harness({ scan: async () => { throw new TokenNotFoundError(ADDR); } });
    await bot.handleUpdate(msg(ADDR));
    expect(calls.at(-1)!.method).toBe('editMessageText');
    expect(calls.at(-1)!.payload.text).toContain("Couldn't find a trading pair");
  });

  it('rate limits after the allowed number of scans', async () => {
    const { bot, calls } = harness({ limit: 1 });
    await bot.handleUpdate(msg(ADDR));
    calls.length = 0;
    await bot.handleUpdate(msg(ADDR));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.payload.text).toContain('Slow down');
  });

  it('refresh button re-scans in place and answers the callback', async () => {
    const { bot, calls } = harness();
    await bot.handleUpdate(cb(`r:base:${ADDR}`));
    const methods = calls.map((c) => c.method);
    expect(methods).toContain('answerCallbackQuery');
    const edit = calls.find((c) => c.method === 'editMessageText')!;
    expect(edit.payload.message_id).toBe(7);
    expect(edit.payload.text).toContain('TEST');
  });

  it('settings button updates the stored risk limit', async () => {
    const { bot, store, calls } = harness();
    await bot.handleUpdate(cb('set:risk:40'));
    expect(store.get(1).maxRisk).toBe(40);
    expect(calls.find((c) => c.method === 'editMessageText')!.payload.text).toContain('Risk limit: 40');
  });

  it('records a referral from /start ref_<id> for new users only', async () => {
    const { bot, store } = harness();
    store.get(500); // existing referrer
    await bot.handleUpdate(msg('/start ref_500', 'private', 2));
    expect(store.referralCount(500)).toBe(1);
    await bot.handleUpdate(msg('/start ref_500', 'private', 2));
    expect(store.referralCount(500)).toBe(1);
  });

  it('shows /stats only to the admin', async () => {
    const { bot, calls } = harness({ adminId: 9 });
    await bot.handleUpdate(msg('/stats', 'private', 1));
    expect(calls).toHaveLength(0);
    await bot.handleUpdate(msg('/stats', 'private', 9));
    expect(calls[0]!.payload.text).toContain('Users:');
  });
});
