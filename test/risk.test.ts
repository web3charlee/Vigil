import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/scanner/risk.js';
import { cleanSafety, market, NOW } from './fixtures.js';

const ids = (r: ReturnType<typeof evaluate>) => r.flags.map((f) => f.id);

describe('evaluate', () => {
  it('rates a healthy token low risk', () => {
    const r = evaluate(market(), cleanSafety(), NOW);
    expect(r.verdict).toBe('low');
    expect(r.score).toBeLessThan(20);
    expect(r.hardBlock).toBe(false);
  });

  it('hard-blocks honeypots as critical regardless of other signals', () => {
    const r = evaluate(market(), cleanSafety({ isHoneypot: true }), NOW);
    expect(r.hardBlock).toBe(true);
    expect(r.verdict).toBe('critical');
    expect(r.score).toBe(100);
    expect(ids(r)).toContain('honeypot');
  });

  it('hard-blocks an extreme sell tax even if not flagged as honeypot', () => {
    const r = evaluate(market(), cleanSafety({ sellTax: 99 }), NOW);
    expect(r.hardBlock).toBe(true);
    expect(r.verdict).toBe('critical');
  });

  it('scores a high sell tax as high risk but not a hard block', () => {
    const r = evaluate(market(), cleanSafety({ sellTax: 25 }), NOW);
    expect(ids(r)).toContain('sell_tax_high');
    expect(r.hardBlock).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  it('ignores the liquidity pool and burn addresses when judging holder concentration', () => {
    const r = evaluate(market(), cleanSafety(), NOW); // pool holds 30%, burn excluded
    expect(ids(r)).not.toContain('top_holder_huge');
    expect(r.top10Percent).toBe(5);
  });

  it('flags a whale wallet that is not the pool', () => {
    const s = cleanSafety({
      topHolders: [{ address: '0xwhale', percent: 35, isContract: false, isLocked: false }],
    });
    const r = evaluate(market(), s, NOW);
    expect(ids(r)).toContain('top_holder_huge');
    expect(r.top10Percent).toBe(35);
    expect(ids(r)).not.toContain('top10_extreme');
  });

  it('flags extreme top-10 concentration across many wallets', () => {
    const topHolders = Array.from({ length: 10 }, (_, i) => ({
      address: `0xholder${i}`,
      percent: 9,
      isContract: false,
      isLocked: false,
    }));
    const r = evaluate(market(), cleanSafety({ topHolders }), NOW);
    expect(r.top10Percent).toBe(90);
    expect(ids(r)).toContain('top10_extreme');
    expect(ids(r)).not.toContain('top_holder_huge');
  });

  it('does not count locked wallets as whales', () => {
    const s = cleanSafety({
      topHolders: [{ address: '0xvest', percent: 40, isContract: true, isLocked: true }],
    });
    expect(ids(evaluate(market(), s, NOW))).not.toContain('top_holder_huge');
  });

  it('flags tiny liquidity and brand-new pools', () => {
    const r = evaluate(market({ liquidityUsd: 2_000, pairCreatedAt: NOW - 20 * 60_000 }), cleanSafety(), NOW);
    expect(ids(r)).toEqual(expect.arrayContaining(['liq_tiny', 'age_brand_new']));
  });

  it('flags unlocked liquidity', () => {
    const r = evaluate(market(), cleanSafety({ lpLockedPercent: 0 }), NOW);
    expect(ids(r)).toContain('lp_unlocked');
  });

  it('marks tokens without contract data as unverified instead of low risk', () => {
    const r = evaluate(market({ chainKey: 'solana' }), null, NOW);
    expect(r.hasSafetyData).toBe(false);
    expect(r.verdict).toBe('unknown');
    expect(ids(r)).toContain('no_safety_data');
  });

  it('still escalates market red flags when contract data is missing', () => {
    const r = evaluate(market({ liquidityUsd: 1_000, pairCreatedAt: NOW - 10 * 60_000 }), null, NOW);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.verdict).toBe('critical');
  });

  it('sorts flags by weight, heaviest first, and caps the score at 100', () => {
    const r = evaluate(
      market({ liquidityUsd: 1_000 }),
      cleanSafety({ isHoneypot: true, hiddenOwner: true, isMintable: true, sellTax: 90 }),
      NOW,
    );
    expect(r.score).toBe(100);
    const weights = r.flags.map((f) => f.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});
