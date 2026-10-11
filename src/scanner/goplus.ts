import { UpstreamError } from '../errors.js';
import type { HolderInfo, SafetyData } from '../types.js';
import type { FetchFn } from './dexscreener.js';

const DEAD = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

type Raw = Record<string, unknown>;

// "" or a burn address in owner_address means nobody currently holds the owner role.
function ownershipRenounced(raw: Raw): boolean | null {
  if (!('owner_address' in raw)) return null;
  const a = String(raw.owner_address ?? '').toLowerCase();
  return a === '' || DEAD.has(a);
}

const bool = (v: unknown): boolean | null => (v === '1' || v === 1 ? true : v === '0' || v === 0 ? false : null);

const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// GoPlus returns ratios as strings ("0.05" = 5%). We store 0..100 everywhere.
const pct = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n * 100;
};

const rows = (v: unknown): Raw[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Raw[]) : []);

export async function fetchGoPlus(
  goplusChainId: string,
  address: string,
  fetchFn: FetchFn = fetch,
  timeoutMs = 8000,
): Promise<SafetyData | null> {
  let res: Response;
  try {
    res = await fetchFn(
      `https://api.gopluslabs.io/api/v1/token_security/${goplusChainId}?contract_addresses=${encodeURIComponent(address)}`,
      { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } },
    );
  } catch (e) {
    throw new UpstreamError('GoPlus', undefined, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new UpstreamError('GoPlus', res.status);
  const json = (await res.json()) as { code?: number; result?: Record<string, Raw> | null };
  const result = json.result;
  if (!result || typeof result !== 'object') return null;
  const raw = result[address.toLowerCase()] ?? Object.values(result)[0];
  if (!raw || Object.keys(raw).length === 0) return null;
  return normalizeGoPlus(raw);
}

export function normalizeGoPlus(raw: Raw): SafetyData {
  const topHolders: HolderInfo[] = rows(raw.holders)
    .map((h) => ({
      address: String(h.address ?? ''),
      percent: pct(h.percent) ?? 0,
      isContract: h.is_contract === '1' || h.is_contract === 1,
      isLocked: h.is_locked === '1' || h.is_locked === 1,
    }))
    .filter((h) => h.address);

  const lp = rows(raw.lp_holders);
  let lpLockedPercent: number | null = null;
  if (lp.length > 0) {
    let locked = 0;
    let total = 0;
    for (const h of lp) {
      const p = pct(h.percent) ?? 0;
      total += p;
      const isLocked = h.is_locked === '1' || h.is_locked === 1;
      if (isLocked || DEAD.has(String(h.address ?? '').toLowerCase())) locked += p;
    }
    // Only meaningful if the reported holders cover a real share of the LP supply.
    if (total > 0) lpLockedPercent = Math.min(100, locked);
  }

  const fake = raw.fake_token;
  const isFakeToken =
    fake && typeof fake === 'object' ? (fake as Raw).value === 1 || (fake as Raw).value === '1' : null;

  return {
    isHoneypot: bool(raw.is_honeypot),
    cannotSellAll: bool(raw.cannot_sell_all),
    buyTax: pct(raw.buy_tax),
    sellTax: pct(raw.sell_tax),
    isOpenSource: bool(raw.is_open_source),
    isProxy: bool(raw.is_proxy),
    isMintable: bool(raw.is_mintable),
    hiddenOwner: bool(raw.hidden_owner),
    canTakeBackOwnership: bool(raw.can_take_back_ownership),
    ownerChangeBalance: bool(raw.owner_change_balance),
    transferPausable: bool(raw.transfer_pausable),
    tradingCooldown: bool(raw.trading_cooldown),
    hasBlacklist: bool(raw.is_blacklisted),
    hasWhitelist: bool(raw.is_whitelisted),
    slippageModifiable: bool(raw.slippage_modifiable),
    selfDestruct: bool(raw.selfdestruct),
    externalCall: bool(raw.external_call),
    isFakeToken,
    creatorHoneypotHistory: bool(raw.honeypot_with_same_creator),
    holderCount: num(raw.holder_count),
    creatorPercent: pct(raw.creator_percent),
    ownerPercent: pct(raw.owner_percent),
    ownershipRenounced: ownershipRenounced(raw),
    topHolders,
    lpLockedPercent,
  };
}
