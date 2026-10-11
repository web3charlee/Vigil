import { InlineKeyboard } from 'grammy';
import { BRAND } from '../brand.js';
import { CHAIN_BY_KEY } from '../chains.js';
import type { ScanResult, Severity, Verdict } from '../types.js';
import { escapeHtml, fmtAge, fmtPct, fmtPrice, fmtSignedPct, fmtUsd } from '../util.js';

const VERDICT_EMOJI: Record<Verdict, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', unknown: '⚪' };
const VERDICT_LABEL: Record<Verdict, string> = {
  critical: 'CRITICAL, do not buy',
  high: 'HIGH RISK',
  medium: 'MEDIUM RISK',
  low: 'LOW RISK',
  unknown: 'UNVERIFIED',
};
const SEVERITY_EMOJI: Record<Severity, string> = { critical: '⛔', high: '🚩', medium: '⚠️', info: 'ℹ️' };

const MAX_FLAGS = 7;

export function formatScan(result: ScanResult, opts: { maxRisk: number; nowMs?: number }): string {
  const { market, safety, report, chain } = result;
  const now = opts.nowMs ?? Date.now();

  const overLimit = report.hardBlock || report.score >= opts.maxRisk;
  const limitLine = !report.hasSafetyData
    ? `⚪ Unverified: contract checks unavailable, so ${BRAND} can't apply your limit (${opts.maxRisk})`
    : overLimit
      ? `⛔ Over your limit (${opts.maxRisk}): ${BRAND} would block this buy`
      : `✅ Within your limit (${opts.maxRisk})`;

  const lines: string[] = [];
  lines.push(`${VERDICT_EMOJI[report.verdict]} <b>${escapeHtml(market.symbol)}</b> · ${escapeHtml(market.name)}`);
  lines.push(`${escapeHtml(chain.name)} · ${escapeHtml(market.dex)} · age ${fmtAge(market.pairCreatedAt, now)}`);
  lines.push('');
  lines.push(`<b>Risk ${report.score}/100 · ${VERDICT_LABEL[report.verdict]}</b>`);
  lines.push(limitLine);
  lines.push('');
  lines.push(`💵 ${fmtPrice(market.priceUsd)} · 24h ${fmtSignedPct(market.priceChange24hPct)}`);
  lines.push(
    `💧 Liq ${fmtUsd(market.liquidityUsd)} · 🏷 MCap ${fmtUsd(market.marketCapUsd ?? market.fdvUsd)} · 📈 Vol ${fmtUsd(market.volume24hUsd)}`,
  );

  if (safety) {
    lines.push(`🧾 Tax buy ${fmtPct(safety.buyTax, 0)} / sell ${fmtPct(safety.sellTax, 0)}`);
    lines.push(
      `👥 Holders ${safety.holderCount?.toLocaleString('en-US') ?? 'n/a'} · Top10 ${fmtPct(report.top10Percent, 0)} · 🔒 LP locked ${market.isConcentratedPool ? 'n/a (v3/v4 pool)' : fmtPct(safety.lpLockedPercent, 0)}`,
    );
  } else {
    lines.push('🧾 Contract data unavailable for this token');
  }

  const shown = report.flags.slice(0, MAX_FLAGS);
  if (shown.length > 0) {
    lines.push('');
    for (const f of shown) lines.push(`${SEVERITY_EMOJI[f.severity]} ${escapeHtml(f.text)}`);
    if (report.flags.length > shown.length) lines.push(`+${report.flags.length - shown.length} more`);
  } else {
    lines.push('');
    lines.push('No red flags found in the automated checks.');
  }

  lines.push('');
  lines.push(`<code>${escapeHtml(market.address)}</code>`);
  lines.push('<i>Automated checks can miss things. Not financial advice.</i>');
  return lines.join('\n');
}

export function shareUrl(result: ScanResult, botUsername: string): string {
  const { market, report, chain } = result;
  const text = `${VERDICT_EMOJI[report.verdict]} ${market.symbol} on ${chain.name}: risk ${report.score}/100 (${VERDICT_LABEL[report.verdict]}). Scanned with ${BRAND}`;
  return `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${botUsername}`)}&text=${encodeURIComponent(text)}`;
}

// callback data: "r:<chain>:<address>" refresh, "s:<chain>:<address>" switch chain (<= 64 bytes)
export function scanKeyboard(result: ScanResult, botUsername: string): InlineKeyboard {
  const { market, chain } = result;
  const kb = new InlineKeyboard().text('🔄 Refresh', `r:${chain.key}:${market.address}`);
  if (market.dexscreenerUrl) kb.url('📊 Chart', market.dexscreenerUrl);
  kb.url('🔍 Explorer', chain.explorerTokenUrl(market.address));

  if (result.otherChains.length > 0) {
    kb.row();
    for (const o of result.otherChains) {
      const name = CHAIN_BY_KEY.get(o.chainKey)?.name ?? o.chainKey;
      kb.text(`Also on ${name}`, `s:${o.chainKey}:${market.address}`);
    }
  }
  kb.row().url('📤 Share', shareUrl(result, botUsername));
  return kb;
}

export function settingsKeyboard(current: number): InlineKeyboard {
  const mark = (n: number) => (n === current ? `✅ ${n}` : String(n));
  return new InlineKeyboard()
    .text(`Strict · ${mark(40)}`, 'set:risk:40')
    .text(`Balanced · ${mark(60)}`, 'set:risk:60')
    .text(`Degen · ${mark(80)}`, 'set:risk:80');
}
