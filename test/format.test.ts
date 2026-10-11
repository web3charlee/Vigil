import { describe, expect, it } from 'vitest';
import { formatScan, scanKeyboard, shareUrl } from '../src/bot/format.js';
import { CHAIN_BY_KEY } from '../src/chains.js';
import { evaluate } from '../src/scanner/risk.js';
import type { ScanResult } from '../src/types.js';
import { cleanSafety, market, NOW } from './fixtures.js';

function result(over: Partial<ScanResult> = {}, m = market(), s = cleanSafety()): ScanResult {
  return {
    chain: CHAIN_BY_KEY.get('base')!,
    market: m,
    safety: s,
    report: evaluate(m, s, NOW),
    otherChains: [],
    ...over,
  };
}

describe('formatScan', () => {
  it('escapes hostile token names so Telegram HTML cannot be injected', () => {
    const m = market({ name: '<script>alert(1)</script>', symbol: '<b>X' });
    const text = formatScan(result({}, m), { maxRisk: 60, nowMs: NOW });
    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;');
  });

  it('says it would block when over the user limit, and not when within it', () => {
    const risky = result({}, market(), cleanSafety({ sellTax: 25 }));
    expect(formatScan(risky, { maxRisk: 40, nowMs: NOW })).toContain('would block');
    expect(formatScan(risky, { maxRisk: 90, nowMs: NOW })).toContain('Within your limit');
  });

  it('always blocks hard-block tokens even at the loosest limit', () => {
    const hp = result({}, market(), cleanSafety({ isHoneypot: true }));
    expect(formatScan(hp, { maxRisk: 100, nowMs: NOW })).toContain('would block');
  });

  it('stays under Telegram’s 4096 character limit with many flags', () => {
    const s = cleanSafety({
      isHoneypot: true, hiddenOwner: true, isMintable: true, hasBlacklist: true, sellTax: 90, buyTax: 40,
      transferPausable: true, selfDestruct: true, isOpenSource: false, lpLockedPercent: 0,
    });
    const text = formatScan(result({}, market({ liquidityUsd: 900 }), s), { maxRisk: 60, nowMs: NOW });
    expect(text.length).toBeLessThan(4096);
    expect(text).toMatch(/\+\d+ more/);
  });

  it('renders without contract data', () => {
    const text = formatScan(result({ safety: null, report: evaluate(market(), null, NOW) }), { maxRisk: 60, nowMs: NOW });
    expect(text).toContain('Contract data unavailable');
  });
});

describe('keyboard', () => {
  it('keeps callback data within Telegram’s 64-byte limit for every chain', () => {
    const sol = 'So11111111111111111111111111111111111111112';
    const evmAddr = '0x' + 'a'.repeat(40);
    for (const key of CHAIN_BY_KEY.keys()) {
      const addr = key === 'solana' ? sol : evmAddr;
      for (const prefix of ['r', 's']) {
        expect(Buffer.byteLength(`${prefix}:${key}:${addr}`)).toBeLessThanOrEqual(64);
      }
    }
  });

  it('adds switch-chain buttons and a share link', () => {
    const r = result({ otherChains: [{ chainKey: 'bsc', liquidityUsd: 1000 }] });
    const flat = scanKeyboard(r, 'vigil_bot').inline_keyboard.flat();
    expect(flat.some((b) => 'callback_data' in b && b.callback_data.startsWith('s:bsc:'))).toBe(true);
    expect(shareUrl(r, 'vigil_bot')).toContain('https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fvigil_bot');
  });
});
