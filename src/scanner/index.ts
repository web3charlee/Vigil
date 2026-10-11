import { CHAIN_BY_KEY } from '../chains.js';
import { TokenNotFoundError } from '../errors.js';
import type { SafetyData, ScanResult } from '../types.js';
import { TtlCache, type AddressKind } from '../util.js';
import { bestPairPerChain, fetchPairs, toMarketData, type FetchFn } from './dexscreener.js';
import { fetchGoPlus } from './goplus.js';
import { evaluate } from './risk.js';

export interface ScanInput {
  address: string;
  kind: AddressKind;
  preferChain?: string;
  fresh?: boolean; // bypass cache
}

export interface ScanDeps {
  fetchFn?: FetchFn;
  now?: () => number;
  cache?: TtlCache<ScanResult>;
  log?: (msg: string) => void;
}

/**
 * Paste an address, get a risk report. If the same address exists on several
 * chains we pick the one with the deepest liquidity and report the others so
 * the UI can offer a switch.
 */
export async function scanToken(input: ScanInput, deps: ScanDeps = {}): Promise<ScanResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const cacheKey = `${input.address.toLowerCase()}:${input.preferChain ?? ''}`;

  if (!input.fresh && deps.cache) {
    const hit = deps.cache.get(cacheKey, now());
    if (hit) return hit;
  }

  const pairs = await fetchPairs(input.address, deps.fetchFn);
  const perChain = bestPairPerChain(pairs, input.address);
  if (perChain.size === 0) throw new TokenNotFoundError(input.address);

  const ranked = [...perChain.entries()].sort(
    (a, b) => (b[1].liquidity?.usd ?? 0) - (a[1].liquidity?.usd ?? 0),
  );
  const chosenKey =
    input.preferChain && perChain.has(input.preferChain) ? input.preferChain : (ranked[0]?.[0] as string);
  const pair = perChain.get(chosenKey)!;
  const chain = CHAIN_BY_KEY.get(chosenKey)!;
  const market = toMarketData(pair, chosenKey);

  let safety: SafetyData | null = null;
  if (chain.goplusId) {
    try {
      safety = await fetchGoPlus(chain.goplusId, input.address, deps.fetchFn);
    } catch (e) {
      // Degrade gracefully: the card still renders, flagged as unverified.
      log(`safety lookup failed for ${chain.key}:${input.address}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const report = evaluate(market, safety, now());
  const otherChains = ranked
    .filter(([k]) => k !== chosenKey)
    .slice(0, 3)
    .map(([k, p]) => ({ chainKey: k, liquidityUsd: p.liquidity?.usd ?? 0 }));

  const result: ScanResult = { chain, market, safety, report, otherChains };
  deps.cache?.set(cacheKey, result, now());
  return result;
}
