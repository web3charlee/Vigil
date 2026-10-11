export interface ChainInfo {
  key: string; // internal key, also used in callback data (keep it short)
  name: string;
  dexscreenerId: string;
  goplusId: string | null; // null = no contract-level safety data for this chain
  evm: boolean;
  explorerTokenUrl: (address: string) => string;
}

export interface MarketData {
  chainKey: string;
  address: string;
  name: string;
  symbol: string;
  dex: string;
  pairAddress: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  pairCreatedAt: number | null; // ms since epoch
  dexscreenerUrl: string | null;
  isConcentratedPool: boolean; // v3/v4-style pool: LP lock % is not meaningful
}

export interface HolderInfo {
  address: string;
  percent: number; // 0..100
  isContract: boolean;
  isLocked: boolean;
}

// All percentages in this structure are 0..100.
export interface SafetyData {
  isHoneypot: boolean | null;
  cannotSellAll: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  isOpenSource: boolean | null;
  isProxy: boolean | null;
  isMintable: boolean | null;
  hiddenOwner: boolean | null;
  canTakeBackOwnership: boolean | null;
  ownerChangeBalance: boolean | null;
  transferPausable: boolean | null;
  tradingCooldown: boolean | null;
  hasBlacklist: boolean | null;
  hasWhitelist: boolean | null;
  slippageModifiable: boolean | null;
  selfDestruct: boolean | null;
  externalCall: boolean | null;
  isFakeToken: boolean | null;
  creatorHoneypotHistory: boolean | null;
  holderCount: number | null;
  creatorPercent: number | null;
  ownerPercent: number | null;
  ownershipRenounced: boolean | null; // null = unknown
  topHolders: HolderInfo[];
  lpLockedPercent: number | null; // share of reported LP supply locked/burned, null if unknown
}

export type Severity = 'critical' | 'high' | 'medium' | 'info';
export type Verdict = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface Flag {
  id: string;
  severity: Severity;
  weight: number;
  text: string;
}

export interface RiskReport {
  score: number; // 0..100, higher = riskier
  verdict: Verdict;
  flags: Flag[];
  hardBlock: boolean; // true if a flag means "never buy this", regardless of user threshold
  hasSafetyData: boolean;
  top10Percent: number | null;
}

export interface ScanResult {
  chain: ChainInfo;
  market: MarketData;
  safety: SafetyData | null;
  report: RiskReport;
  otherChains: { chainKey: string; liquidityUsd: number }[];
}
