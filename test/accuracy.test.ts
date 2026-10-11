// Regression tests for false positives found in live scans (PEPE, WETH, wrapped SOL).
import { describe, expect, it } from 'vitest';
import { formatScan } from '../src/bot/format.js';
import { CHAIN_BY_KEY } from '../src/chains.js';
import { isConcentrated, toMarketData, type RawPair } from '../src/scanner/dexscreener.js';
import { normalizeGoPlus } from '../src/scanner/goplus.js';
import { evaluate } from '../src/scanner/risk.js';
import type { ScanResult } from '../src/types.js';
import { cleanSafety, dexPair, goplusRaw, market, NOW } from './fixtures.js';

const ids = (r: ReturnType<typeof evaluate>) => r.flags.map((f) => f.id);

describe('renounced ownership (the PEPE case)', () => {
  // Real-world shape: big, old, liquid token; pause + blacklist code exists but owner is renounced;
  // liquidity sits in a v3/v4 pool where "LP locked" does not apply.
  const pepeMarket = () =>
    market({ liquidityUsd: 29_690_000, fdvUsd: 1_670_000_000, marketCapUsd: 1_670_000_000, isConcentratedPool: true });
  const pepeSafety = (over = {}) =>
    cleanSafety({
      ownershipRenounced: true,
      transferPausable: true,
      hasBlacklist: true,
      lpLockedPercent: 0,
      holderCount: 597_553,
      ...over,
    });

  it('does not call a renounced, liquid, aged token critical', () => {
    const r = evaluate(pepeMarket(), pepeSafety(), NOW);
    expect(r.verdict).toBe('low');
    expect(r.hardBlock).toBe(false);
    expect(r.score).toBeLessThan(20);
    expect(ids(r)).toContain('admin_dormant');
    expect(ids(r)).not.toEqual(expect.arrayContaining(['pausable']));
    expect(ids(r)).not.toContain('blacklist');
    expect(ids(r)).not.toContain('lp_unlocked');
  });

  it('still penalises the same powers when an owner is active', () => {
    const r = evaluate(pepeMarket(), pepeSafety({ ownershipRenounced: false }), NOW);
    expect(ids(r)).toEqual(expect.arrayContaining(['pausable', 'blacklist']));
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  it('treats unknown ownership conservatively (powers still count)', () => {
    const r = evaluate(pepeMarket(), pepeSafety({ ownershipRenounced: null }), NOW);
    expect(ids(r)).toContain('pausable');
  });

  it('does not trust "renounced" if ownership can be reclaimed', () => {
    const r = evaluate(pepeMarket(), pepeSafety({ canTakeBackOwnership: true }), NOW);
    expect(ids(r)).toEqual(expect.arrayContaining(['retake_owner', 'pausable']));
  });

  it('does not trust "renounced" if the owner is hidden', () => {
    const r = evaluate(pepeMarket(), pepeSafety({ hiddenOwner: true }), NOW);
    expect(ids(r)).toEqual(expect.arrayContaining(['hidden_owner', 'pausable']));
  });

  it('ignores owner balance share once ownership is renounced, but not before', () => {
    expect(ids(evaluate(market(), cleanSafety({ ownershipRenounced: true, ownerPercent: 15 }), NOW))).not.toContain('owner_bag');
    expect(ids(evaluate(market(), cleanSafety({ ownershipRenounced: false, ownerPercent: 15 }), NOW))).toContain('owner_bag');
  });

  it('does not let renounced ownership hide an extreme sell tax or honeypot', () => {
    expect(evaluate(market(), cleanSafety({ ownershipRenounced: true, isHoneypot: true }), NOW).hardBlock).toBe(true);
    expect(evaluate(market(), cleanSafety({ ownershipRenounced: true, sellTax: 90 }), NOW).hardBlock).toBe(true);
  });
});

describe('contract holders (the WETH case)', () => {
  it('does not raise a whale warning for a contract holding a large share', () => {
    const s = cleanSafety({
      topHolders: [{ address: '0xbridge0000000000000000000000000000000001', percent: 30.4, isContract: true, isLocked: false }],
    });
    const r = evaluate(market(), s, NOW);
    expect(ids(r)).not.toContain('top_holder_huge');
    expect(ids(r)).toContain('contract_holder');
    expect(r.verdict).toBe('low');
  });

  it('still raises the whale warning for an individual wallet next to a contract', () => {
    const s = cleanSafety({
      topHolders: [
        { address: '0xbridge0000000000000000000000000000000001', percent: 30, isContract: true, isLocked: false },
        { address: '0xwhale00000000000000000000000000000000001', percent: 22, isContract: false, isLocked: false },
      ],
    });
    expect(ids(evaluate(market(), s, NOW))).toContain('top_holder_huge');
  });
});

describe('concentrated-liquidity pools', () => {
  it('skips the LP-lock check for v3/v4 pools but keeps it for v2 pools', () => {
    const s = cleanSafety({ lpLockedPercent: 0 });
    expect(ids(evaluate(market({ isConcentratedPool: true }), s, NOW))).not.toContain('lp_unlocked');
    expect(ids(evaluate(market({ isConcentratedPool: false }), s, NOW))).toContain('lp_unlocked');
  });

  it('detects v3/v4 style pools from DexScreener labels or dex id', () => {
    const base = { chainId: 'base', pairAddress: '0xp', baseToken: { address: '0xa' } } as RawPair;
    expect(isConcentrated({ ...base, dexId: 'uniswap', labels: ['v3'] })).toBe(true);
    expect(isConcentrated({ ...base, dexId: 'uniswap', labels: ['v4'] })).toBe(true);
    expect(isConcentrated({ ...base, dexId: 'raydium', labels: ['CLMM'] })).toBe(true);
    expect(isConcentrated({ ...base, dexId: 'uniswap', labels: ['v2'] })).toBe(false);
    expect(isConcentrated({ ...base, dexId: 'uniswap', labels: null })).toBe(false);
  });

  it('carries the flag into market data', () => {
    const m = toMarketData(dexPair('base', 1000, { labels: ['v3'] }) as unknown as RawPair, 'base');
    expect(m.isConcentratedPool).toBe(true);
  });
});

describe('ownership parsing', () => {
  it('reads empty and burn owner addresses as renounced, a real address as not, and absence as unknown', () => {
    expect(normalizeGoPlus(goplusRaw({ owner_address: '' })).ownershipRenounced).toBe(true);
    expect(normalizeGoPlus(goplusRaw({ owner_address: '0x0000000000000000000000000000000000000000' })).ownershipRenounced).toBe(true);
    expect(normalizeGoPlus(goplusRaw({ owner_address: '0x000000000000000000000000000000000000dEaD' })).ownershipRenounced).toBe(true);
    expect(normalizeGoPlus(goplusRaw()).ownershipRenounced).toBe(false);
    expect(normalizeGoPlus({}).ownershipRenounced).toBeNull();
  });
});

describe('card honesty', () => {
  const result = (over: Partial<ScanResult>): ScanResult => {
    const m = market();
    const s = cleanSafety();
    return { chain: CHAIN_BY_KEY.get('base')!, market: m, safety: s, report: evaluate(m, s, NOW), otherChains: [], ...over };
  };

  it('does not show a green "within your limit" for an unverified token (the SOL case)', () => {
    const m = market({ chainKey: 'solana' });
    const text = formatScan(
      result({ chain: CHAIN_BY_KEY.get('solana')!, market: m, safety: null, report: evaluate(m, null, NOW) }),
      { maxRisk: 60, nowMs: NOW },
    );
    expect(text).toContain('Unverified');
    expect(text).not.toContain('Within your limit');
    expect(text).not.toContain('✅');
  });

  it('shows n/a for LP lock on v3/v4 pools and comma-separates the holder count', () => {
    const m = market({ isConcentratedPool: true });
    const s = cleanSafety({ holderCount: 5_308_820, lpLockedPercent: 0 });
    const text = formatScan(result({ market: m, safety: s, report: evaluate(m, s, NOW) }), { maxRisk: 60, nowMs: NOW });
    expect(text).toContain('n/a (v3/v4 pool)');
    expect(text).toContain('5,308,820');
  });
});

describe('established pools (the PEPE LP case)', () => {
  const DAY = 86_400_000;
  const aged = (days: number, liquidityUsd: number) =>
    market({ pairCreatedAt: NOW - days * DAY, liquidityUsd, fdvUsd: liquidityUsd * 20, isConcentratedPool: false });
  const unlockedLp = cleanSafety({ lpLockedPercent: 0, ownershipRenounced: true });

  it('only notes unlocked LP on an old, deep v2-style pool', () => {
    const r = evaluate(aged(1275, 29_550_000), unlockedLp, NOW);
    expect(ids(r)).toContain('lp_unlocked_established');
    expect(ids(r)).not.toContain('lp_unlocked');
    expect(r.verdict).toBe('low');
  });

  it('still flags unlocked LP on a young pool, even a deep one', () => {
    expect(ids(evaluate(aged(30, 29_550_000), unlockedLp, NOW))).toContain('lp_unlocked');
  });

  it('still flags unlocked LP on an old but shallow pool', () => {
    expect(ids(evaluate(aged(1275, 400_000), unlockedLp, NOW))).toContain('lp_unlocked');
  });

  it('treats partially locked LP the same way', () => {
    const partial = cleanSafety({ lpLockedPercent: 70, ownershipRenounced: true });
    expect(ids(evaluate(aged(400, 5_000_000), partial, NOW))).toContain('lp_unlocked_established');
    expect(ids(evaluate(aged(10, 5_000_000), partial, NOW))).toContain('lp_partial');
  });
});
