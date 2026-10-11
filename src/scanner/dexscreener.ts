import { CHAIN_BY_DEX_ID } from '../chains.js';
import { UpstreamError } from '../errors.js';
import type { MarketData } from '../types.js';

export type FetchFn = typeof fetch;

export interface RawPair {
  chainId: string;
  dexId?: string;
  url?: string;
  pairAddress: string;
  baseToken: { address: string; name?: string; symbol?: string };
  quoteToken?: { address: string; name?: string; symbol?: string };
  priceUsd?: string | number;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  pairCreatedAt?: number;
  labels?: string[] | null;
}

const API = 'https://api.dexscreener.com';

async function getJson(url: string, fetchFn: FetchFn, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  } catch (e) {
    throw new UpstreamError('DexScreener', undefined, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new UpstreamError('DexScreener', res.status);
  return res.json();
}

/** Endpoints answer with {pairs: [...]} or a bare array depending on version. */
export function extractPairs(json: unknown): RawPair[] {
  if (Array.isArray(json)) return json as RawPair[];
  if (json && typeof json === 'object' && Array.isArray((json as { pairs?: unknown }).pairs)) {
    return (json as { pairs: RawPair[] }).pairs;
  }
  return [];
}

/**
 * Cross-chain lookup by token address. The /latest/dex/tokens endpoint works today but is missing from
 * DexScreener's current API reference, so if it errors or comes back empty we fall back to the
 * documented /latest/dex/search endpoint instead of failing.
 */
export async function fetchPairs(
  address: string,
  fetchFn: FetchFn = fetch,
  timeoutMs = 8000,
): Promise<RawPair[]> {
  const enc = encodeURIComponent(address);
  const urls = [`${API}/latest/dex/tokens/${enc}`, `${API}/latest/dex/search?q=${enc}`];
  let answered = false;
  let lastError: UpstreamError | null = null;
  for (const url of urls) {
    try {
      const pairs = extractPairs(await getJson(url, fetchFn, timeoutMs));
      answered = true;
      if (pairs.length > 0) return pairs;
    } catch (e) {
      lastError = e instanceof UpstreamError ? e : new UpstreamError('DexScreener', undefined, String(e));
    }
  }
  if (!answered && lastError) throw lastError;
  return [];
}

const sameAddress = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase();

/** Highest-liquidity pair for the token on each supported chain. Keyed by chain key. */
export function bestPairPerChain(pairs: RawPair[], address: string): Map<string, RawPair> {
  const best = new Map<string, RawPair>();
  for (const p of pairs) {
    const chain = CHAIN_BY_DEX_ID.get(p.chainId);
    if (!chain) continue;
    if (!p.baseToken?.address || !sameAddress(p.baseToken.address, address)) continue;
    const cur = best.get(chain.key);
    if ((p.liquidity?.usd ?? 0) > (cur?.liquidity?.usd ?? -1)) best.set(chain.key, p);
  }
  return best;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const CONCENTRATED_RE = /v[34]|clmm|slipstream|algebra|whirlpool|concentrated/i;

export function isConcentrated(pair: RawPair): boolean {
  return CONCENTRATED_RE.test((pair.labels ?? []).join(' ')) || CONCENTRATED_RE.test(pair.dexId ?? '');
}

export function toMarketData(pair: RawPair, chainKey: string): MarketData {
  return {
    chainKey,
    address: pair.baseToken.address,
    name: pair.baseToken.name ?? 'Unknown',
    symbol: pair.baseToken.symbol ?? '?',
    dex: pair.dexId ?? 'unknown',
    pairAddress: pair.pairAddress,
    priceUsd: toNum(pair.priceUsd),
    liquidityUsd: toNum(pair.liquidity?.usd),
    fdvUsd: toNum(pair.fdv),
    marketCapUsd: toNum(pair.marketCap),
    volume24hUsd: toNum(pair.volume?.h24),
    priceChange24hPct: toNum(pair.priceChange?.h24),
    pairCreatedAt: toNum(pair.pairCreatedAt),
    dexscreenerUrl: pair.url ?? null,
    isConcentratedPool: isConcentrated(pair),
  };
}
