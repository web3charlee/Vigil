import { describe, expect, it } from 'vitest';
import { TokenNotFoundError, UpstreamError } from '../src/errors.js';
import { normalizeGoPlus } from '../src/scanner/goplus.js';
import { scanToken } from '../src/scanner/index.js';
import { TtlCache } from '../src/util.js';
import type { ScanResult } from '../src/types.js';
import { dexPair, goplusRaw, NOW } from './fixtures.js';

const ADDR = '0x1111111111111111111111111111111111111111';

/** Fake fetch that routes by URL and counts calls. */
function mockFetch(opts: { pairs?: unknown[] | null; goplus?: Record<string, unknown> | null; goplusStatus?: number }) {
  const calls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('dexscreener')) {
      return new Response(JSON.stringify({ pairs: opts.pairs ?? null }), { status: 200 });
    }
    if (u.includes('gopluslabs')) {
      if (opts.goplusStatus && opts.goplusStatus !== 200) return new Response('nope', { status: opts.goplusStatus });
      const body = opts.goplus === undefined ? { code: 1, result: { [ADDR]: goplusRaw() } } : { code: 1, result: opts.goplus };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('scanToken', () => {
  it('picks the deepest-liquidity chain and lists the others', async () => {
    const { fn, calls } = mockFetch({
      pairs: [dexPair('base', 500_000), dexPair('bsc', 80_000), dexPair('base', 20_000)],
    });
    const r = await scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn, now: () => NOW });
    expect(r.chain.key).toBe('base');
    expect(r.market.liquidityUsd).toBe(500_000);
    expect(r.otherChains).toEqual([{ chainKey: 'bsc', liquidityUsd: 80_000 }]);
    expect(calls.some((c) => c.includes('/token_security/8453'))).toBe(true);
  });

  it('honours a preferred chain and queries that chain’s safety endpoint', async () => {
    const { fn, calls } = mockFetch({ pairs: [dexPair('base', 500_000), dexPair('bsc', 80_000)] });
    const r = await scanToken({ address: ADDR, kind: 'evm', preferChain: 'bsc' }, { fetchFn: fn, now: () => NOW });
    expect(r.chain.key).toBe('bsc');
    expect(calls.some((c) => c.includes('/token_security/56'))).toBe(true);
  });

  it('throws TokenNotFoundError when there are no pairs', async () => {
    const { fn } = mockFetch({ pairs: null });
    await expect(scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn })).rejects.toBeInstanceOf(TokenNotFoundError);
  });

  it('ignores pairs where the address is only the quote token', async () => {
    const quoteOnly = dexPair('base', 900_000, { baseToken: { address: '0xother', symbol: 'X', name: 'X' } });
    const { fn } = mockFetch({ pairs: [quoteOnly] });
    await expect(scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn })).rejects.toBeInstanceOf(TokenNotFoundError);
  });

  it('degrades to an unverified card if the safety provider errors', async () => {
    const { fn } = mockFetch({ pairs: [dexPair('base', 500_000)], goplusStatus: 500 });
    const logs: string[] = [];
    const r = await scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn, now: () => NOW, log: (m) => logs.push(m) });
    expect(r.safety).toBeNull();
    expect(r.report.flags.map((f) => f.id)).toContain('no_safety_data');
    expect(logs).toHaveLength(1);
  });

  it('does not call the safety provider for Solana and marks it unverified', async () => {
    const mint = 'So11111111111111111111111111111111111111112';
    const { fn, calls } = mockFetch({
      pairs: [dexPair('solana', 300_000, { baseToken: { address: mint, name: 'Wrapped SOL', symbol: 'SOL' } })],
    });
    const r = await scanToken({ address: mint, kind: 'solana' }, { fetchFn: fn, now: () => NOW });
    expect(r.chain.key).toBe('solana');
    expect(calls.some((c) => c.includes('gopluslabs'))).toBe(false);
    expect(r.report.verdict).toBe('unknown');
  });

  it('serves repeat scans from cache unless fresh is requested', async () => {
    const { fn, calls } = mockFetch({ pairs: [dexPair('base', 500_000)] });
    const cache = new TtlCache<ScanResult>(60_000);
    const deps = { fetchFn: fn, cache, now: () => NOW };
    await scanToken({ address: ADDR, kind: 'evm' }, deps);
    const after1 = calls.length;
    await scanToken({ address: ADDR, kind: 'evm' }, deps);
    expect(calls.length).toBe(after1);
    await scanToken({ address: ADDR, kind: 'evm', fresh: true }, deps);
    expect(calls.length).toBeGreaterThan(after1);
  });
});

describe('normalizeGoPlus', () => {
  it('converts ratio strings to percentages and parses flags', () => {
    const s = normalizeGoPlus(goplusRaw({ sell_tax: '0.25', is_honeypot: '1', holder_count: '321' }));
    expect(s.sellTax).toBe(25);
    expect(s.isHoneypot).toBe(true);
    expect(s.holderCount).toBe(321);
    expect(s.topHolders[0]?.percent).toBe(40);
  });

  it('computes locked LP share from burn addresses and lock flags', () => {
    expect(normalizeGoPlus(goplusRaw()).lpLockedPercent).toBeCloseTo(95, 5);
  });

  it('keeps unknown fields as null rather than guessing', () => {
    const s = normalizeGoPlus({});
    expect(s.isHoneypot).toBeNull();
    expect(s.sellTax).toBeNull();
    expect(s.lpLockedPercent).toBeNull();
  });
});

describe('DexScreener endpoint fallback', () => {
  type Route = { status: number; body?: unknown };
  function routedFetch(legacy: Route, search: Route) {
    const calls: string[] = [];
    const fn = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      const route = u.includes('/latest/dex/search') ? search : u.includes('/latest/dex/tokens/') ? legacy : null;
      if (route) return new Response(JSON.stringify(route.body ?? {}), { status: route.status });
      if (u.includes('gopluslabs')) return new Response(JSON.stringify({ code: 1, result: { [ADDR]: goplusRaw() } }), { status: 200 });
      return new Response('?', { status: 404 });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }
  const good = { pairs: [dexPair('base', 500_000)] };

  it('uses only the cross-chain endpoint when it works', async () => {
    const { fn, calls } = routedFetch({ status: 200, body: good }, { status: 500 });
    await scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn, now: () => NOW });
    expect(calls.some((c) => c.includes('/latest/dex/search'))).toBe(false);
  });

  it('falls back to the documented search endpoint if the cross-chain endpoint is gone (404)', async () => {
    const { fn, calls } = routedFetch({ status: 404 }, { status: 200, body: good });
    const r = await scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn, now: () => NOW });
    expect(r.chain.key).toBe('base');
    expect(calls.some((c) => c.includes('/latest/dex/search?q='))).toBe(true);
  });

  it('falls back to search when the cross-chain endpoint answers with no pairs', async () => {
    const { fn } = routedFetch({ status: 200, body: { pairs: null } }, { status: 200, body: good });
    const r = await scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn, now: () => NOW });
    expect(r.market.liquidityUsd).toBe(500_000);
  });

  it('accepts a bare-array response shape', async () => {
    const { fn } = routedFetch({ status: 200, body: [dexPair('base', 123_000)] }, { status: 500 });
    const r = await scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn, now: () => NOW });
    expect(r.market.liquidityUsd).toBe(123_000);
  });

  it('reports a provider error (not "token not found") when every endpoint fails', async () => {
    const { fn } = routedFetch({ status: 500 }, { status: 503 });
    await expect(scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn })).rejects.toBeInstanceOf(UpstreamError);
  });

  it('reports not-found when the endpoints answer but know nothing', async () => {
    const { fn } = routedFetch({ status: 200, body: { pairs: null } }, { status: 200, body: { pairs: [] } });
    await expect(scanToken({ address: ADDR, kind: 'evm' }, { fetchFn: fn })).rejects.toBeInstanceOf(TokenNotFoundError);
  });
});
