export type AddressKind = 'evm' | 'solana';

const EVM_RE = /\b0x[a-fA-F0-9]{40}\b/;
const SOL_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

export function extractAddress(text: string): { address: string; kind: AddressKind } | null {
  const evm = EVM_RE.exec(text);
  if (evm) return { address: evm[0].toLowerCase(), kind: 'evm' };
  const sol = SOL_RE.exec(text);
  if (sol) return { address: sol[0], kind: 'solana' };
  return null;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
export function fmtPrice(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  if (n === 0) return '$0';
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (n >= 0.0001) return `$${Number(n.toPrecision(4))}`;
  // tiny prices: $0.0₅123 style (subscript = count of zeros after the decimal point)
  const [mantissa = '', exp = ''] = n.toExponential(3).split('e');
  const exponent = Number(exp);
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0';
  const zeros = String(-exponent - 1)
    .split('')
    .map((d) => SUB[Number(d)] ?? d)
    .join('');
  return `$0.0${zeros}${digits}`;
}

export function fmtPct(n: number | null, decimals = 1): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  return `${n.toFixed(decimals)}%`;
}

export function fmtSignedPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function fmtAge(createdAtMs: number | null, nowMs: number): string {
  if (createdAtMs === null) return 'n/a';
  const mins = Math.max(0, Math.floor((nowMs - createdAtMs) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private ttlMs: number, private maxSize = 500) {}

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.v;
  }

  set(key: string, v: V, now = Date.now()): void {
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { v, exp: now + this.ttlMs });
  }
}
