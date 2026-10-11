import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/bot/limiter.js';
import { UserStore } from '../src/bot/store.js';
import { escapeHtml, extractAddress, fmtAge, fmtPrice, fmtUsd, TtlCache } from '../src/util.js';

describe('extractAddress', () => {
  it('finds and lowercases an EVM address inside text', () => {
    const r = extractAddress('check 0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD pls');
    expect(r).toEqual({ address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', kind: 'evm' });
  });

  it('finds a Solana mint', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    expect(extractAddress(`scan ${mint}`)).toEqual({ address: mint, kind: 'solana' });
  });

  it('does not treat a 64-hex transaction hash as an address', () => {
    expect(extractAddress('0x' + 'a'.repeat(64))).toBeNull();
  });

  it('returns null for ordinary text', () => {
    expect(extractAddress('hello how are you')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats USD compactly', () => {
    expect(fmtUsd(1_234)).toBe('$1.2K');
    expect(fmtUsd(2_500_000)).toBe('$2.50M');
    expect(fmtUsd(null)).toBe('n/a');
  });

  it('formats tiny prices with a subscript zero count', () => {
    expect(fmtPrice(0.00000123)).toBe('$0.0₅123');
    expect(fmtPrice(0.0123)).toBe('$0.0123');
    expect(fmtPrice(2.5)).toBe('$2.5');
    expect(fmtPrice(0.000000000456)).toBe('$0.0₉456');
    expect(fmtPrice(0.00009)).toBe('$0.0₄9');
  });

  it('formats age', () => {
    const now = 10 * 24 * 3_600_000;
    expect(fmtAge(now - 5 * 60_000, now)).toBe('5m');
    expect(fmtAge(now - 5 * 3_600_000, now)).toBe('5h');
    expect(fmtAge(now - 5 * 24 * 3_600_000, now)).toBe('5d');
  });

  it('escapes HTML', () => {
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;');
  });
});

describe('TtlCache', () => {
  it('expires entries', () => {
    const c = new TtlCache<number>(1000);
    c.set('a', 1, 0);
    expect(c.get('a', 500)).toBe(1);
    expect(c.get('a', 1500)).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('blocks after the limit and recovers after the window', () => {
    const l = new RateLimiter(2, 1000);
    expect(l.check(1, 0).ok).toBe(true);
    expect(l.check(1, 10).ok).toBe(true);
    const third = l.check(1, 20);
    expect(third.ok).toBe(false);
    expect(l.check(1, 1100).ok).toBe(true);
    expect(l.check(2, 20).ok).toBe(true); // other users unaffected
  });
});

describe('UserStore referrals', () => {
  it('credits a referrer only for new users and never for self', () => {
    const s = new UserStore(null);
    s.get(100); // referrer exists
    expect(s.registerStart(200, 100).isNew).toBe(true);
    expect(s.registerStart(200, 100).isNew).toBe(false);
    expect(s.registerStart(300, 300).isNew).toBe(true); // self-referral ignored
    expect(s.registerStart(400, 999).isNew).toBe(true); // unknown referrer ignored
    expect(s.referralCount(100)).toBe(1);
    expect(s.referralCount(300)).toBe(0);
    expect(s.stats()).toMatchObject({ users: 4, referred: 1 });
  });

  it('clamps the risk limit', () => {
    const s = new UserStore(null);
    s.setMaxRisk(1, 500);
    expect(s.get(1).maxRisk).toBe(100);
  });
});
