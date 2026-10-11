import type { Flag, MarketData, RiskReport, SafetyData, Severity, Verdict } from '../types.js';
import { fmtPct, fmtUsd } from '../util.js';

const DEAD = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

/** Top holders minus the liquidity pool, burn addresses and locked wallets. Sorted desc. */
export function effectiveHolders(safety: SafetyData, pairAddress: string) {
  const pair = pairAddress.toLowerCase();
  return safety.topHolders
    .filter((h) => !h.isLocked && !DEAD.has(h.address.toLowerCase()) && h.address.toLowerCase() !== pair)
    .sort((a, b) => b.percent - a.percent);
}

export function verdictFor(score: number): Verdict {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

export function evaluate(market: MarketData, safety: SafetyData | null, nowMs: number = Date.now()): RiskReport {
  const flags: Flag[] = [];
  const add = (id: string, severity: Severity, weight: number, text: string) =>
    flags.push({ id, severity, weight, text });
  let hardBlock = false;

  // ---- Market-level checks (available on every chain) ----
  const liq = market.liquidityUsd;
  if (liq === null) add('liq_unknown', 'medium', 10, 'Liquidity unknown');
  else if (liq < 5_000) add('liq_tiny', 'high', 35, `Very low liquidity (${fmtUsd(liq)}): easy to rug, hard to exit`);
  else if (liq < 25_000) add('liq_low', 'medium', 20, `Low liquidity (${fmtUsd(liq)}): expect heavy slippage`);
  else if (liq < 100_000) add('liq_modest', 'info', 8, `Modest liquidity (${fmtUsd(liq)})`);

  if (market.pairCreatedAt !== null) {
    const hours = (nowMs - market.pairCreatedAt) / 3_600_000;
    if (hours < 1) add('age_brand_new', 'high', 20, 'Pool is under 1 hour old');
    else if (hours < 24) add('age_new', 'medium', 10, 'Pool is under 24 hours old');
    else if (hours < 168) add('age_young', 'info', 4, 'Pool is under 7 days old');
  }

  const valuation = market.fdvUsd ?? market.marketCapUsd;
  if (valuation && liq && liq > 0 && valuation / liq > 100) {
    add('valuation_thin', 'medium', 10, `Valuation is ${Math.round(valuation / liq)}x the liquidity`);
  }

  // ---- Contract-level checks (EVM chains with safety data) ----
  let top10Percent: number | null = null;

  if (!safety) {
    add('no_safety_data', 'medium', 25, 'Contract safety data unavailable: treat as unverified');
  } else {
    if (safety.isFakeToken) {
      add('fake_token', 'critical', 100, 'Flagged as a fake or impersonator token');
      hardBlock = true;
    }
    if (safety.isHoneypot) {
      add('honeypot', 'critical', 100, 'Honeypot: buyers cannot sell');
      hardBlock = true;
    }
    if (safety.cannotSellAll) {
      add('cannot_sell_all', 'critical', 60, 'Contract blocks selling your full balance');
      hardBlock = true;
    }

    const st = safety.sellTax;
    if (st !== null) {
      if (st >= 50) {
        add('sell_tax_extreme', 'critical', 80, `Sell tax ${fmtPct(st, 0)}: effectively a honeypot`);
        hardBlock = true;
      } else if (st >= 20) add('sell_tax_high', 'high', 40, `High sell tax (${fmtPct(st, 0)})`);
      else if (st >= 10) add('sell_tax_elevated', 'medium', 20, `Elevated sell tax (${fmtPct(st, 0)})`);
      else if (st >= 5) add('sell_tax_notable', 'info', 5, `Sell tax ${fmtPct(st, 0)}`);
    }
    const bt = safety.buyTax;
    if (bt !== null) {
      if (bt >= 30) add('buy_tax_high', 'high', 40, `High buy tax (${fmtPct(bt, 0)})`);
      else if (bt >= 10) add('buy_tax_elevated', 'medium', 20, `Elevated buy tax (${fmtPct(bt, 0)})`);
      else if (bt >= 5) add('buy_tax_notable', 'info', 8, `Buy tax ${fmtPct(bt, 0)}`);
    }

    if (safety.creatorHoneypotHistory) add('creator_history', 'high', 50, 'Deployer has created honeypots before');
    if (safety.hiddenOwner) add('hidden_owner', 'high', 25, 'Hidden owner: control can be concealed');
    if (safety.canTakeBackOwnership) add('retake_owner', 'high', 25, 'Owner can reclaim ownership after renouncing');
    if (safety.selfDestruct) add('selfdestruct', 'high', 30, 'Contract can self-destruct');
    if (safety.isOpenSource === false) add('unverified_source', 'high', 25, 'Contract source code is not verified');

    // Owner-only powers matter only if someone still holds the owner role. If ownership is genuinely
    // renounced (and can't be reclaimed or hidden), collapse them into one low-weight note.
    const ownerless =
      safety.ownershipRenounced === true && !safety.canTakeBackOwnership && !safety.hiddenOwner;
    const dormant: string[] = [];
    const ownerPower = (on: boolean | null, label: string, id: string, severity: Severity, weight: number, text: string) => {
      if (!on) return;
      if (ownerless) dormant.push(label);
      else add(id, severity, weight, text);
    };
    ownerPower(safety.ownerChangeBalance, 'balance-edit', 'owner_balance', 'critical', 40, 'Owner can change holder balances');
    ownerPower(safety.transferPausable, 'pause', 'pausable', 'high', 25, 'Owner can pause all transfers');
    ownerPower(safety.isMintable, 'mint', 'mintable', 'medium', 15, 'Owner can mint new supply');
    ownerPower(safety.hasBlacklist, 'blacklist', 'blacklist', 'medium', 20, 'Contract can blacklist wallets');
    ownerPower(safety.hasWhitelist, 'whitelist', 'whitelist', 'medium', 20, 'Trading restricted to a whitelist');
    ownerPower(safety.slippageModifiable, 'tax-change', 'tax_modifiable', 'medium', 20, 'Owner can change the taxes at any time');
    if (dormant.length > 0) {
      add('admin_dormant', 'info', 3, `Has ${dormant.join('/')} functions, but ownership is renounced`);
    }

    if (safety.tradingCooldown) add('cooldown', 'info', 10, 'Trading cooldown between transactions');
    if (safety.isProxy) add('proxy', 'info', 10, 'Upgradeable proxy: logic can change');
    if (safety.externalCall) add('external_call', 'info', 5, 'Contract makes external calls');

    // Whale checks apply to individual wallets. A contract holding a big share is usually a pool,
    // bridge, vault or team multisig, so it gets a low-weight note instead of a whale warning.
    const eff = effectiveHolders(safety, market.pairAddress);
    const topWallet = eff.find((h) => !h.isContract);
    if (topWallet) {
      if (topWallet.percent >= 20) add('top_holder_huge', 'high', 30, `One wallet holds ${fmtPct(topWallet.percent)}`);
      else if (topWallet.percent >= 10) add('top_holder_big', 'medium', 15, `One wallet holds ${fmtPct(topWallet.percent)}`);
    }
    const topContract = eff.find((h) => h.isContract);
    if (topContract && topContract.percent >= 20) {
      add('contract_holder', 'info', 4, `A contract holds ${fmtPct(topContract.percent)} (pool, bridge, vault or multisig)`);
    }
    if (eff.length > 0) {
      top10Percent = eff.slice(0, 10).reduce((s, h) => s + h.percent, 0);
      if (top10Percent >= 80) add('top10_extreme', 'high', 25, `Top 10 wallets hold ${fmtPct(top10Percent, 0)}`);
      else if (top10Percent >= 50) add('top10_high', 'medium', 12, `Top 10 wallets hold ${fmtPct(top10Percent, 0)}`);
    }
    if (safety.creatorPercent !== null) {
      if (safety.creatorPercent >= 10) add('creator_bag_big', 'high', 20, `Deployer holds ${fmtPct(safety.creatorPercent)}`);
      else if (safety.creatorPercent >= 5) add('creator_bag', 'medium', 8, `Deployer holds ${fmtPct(safety.creatorPercent)}`);
    }
    if (safety.ownerPercent !== null && safety.ownerPercent >= 10 && !ownerless) {
      add('owner_bag', 'medium', 15, `Owner holds ${fmtPct(safety.ownerPercent)}`);
    }
    if (safety.holderCount !== null) {
      if (safety.holderCount < 50) add('holders_tiny', 'high', 15, `Only ${safety.holderCount} holders`);
      else if (safety.holderCount < 200) add('holders_few', 'medium', 6, `Only ${safety.holderCount} holders`);
    }
    // LP tokens are fungible and lockable only on v2-style pools. v3/v4 liquidity is a position,
    // so a "0% locked" reading there is meaningless and must not count against the token.
    // On v2-style pools, unlocked LP is a real rug risk for new or thin pools, but a weak signal for a
    // pool that is old and deep (6+ months, $1M+): that history is itself evidence, so it only gets a note.
    if (safety.lpLockedPercent !== null && !market.isConcentratedPool && safety.lpLockedPercent < 90) {
      const ageDays = market.pairCreatedAt === null ? 0 : (nowMs - market.pairCreatedAt) / 86_400_000;
      const established = ageDays >= 180 && (liq ?? 0) >= 1_000_000;
      if (established) {
        add('lp_unlocked_established', 'info', 3, 'Liquidity is not locked or burned, but the pool is old and deep');
      } else if (safety.lpLockedPercent < 50) {
        add('lp_unlocked', 'high', 25, `Only ${fmtPct(safety.lpLockedPercent, 0)} of liquidity is locked or burned`);
      } else {
        add('lp_partial', 'medium', 8, `${fmtPct(safety.lpLockedPercent, 0)} of liquidity locked or burned`);
      }
    }
  }

  let score = Math.min(
    100,
    flags.reduce((s, f) => s + f.weight, 0),
  );
  if (hardBlock) score = Math.max(score, 80);

  let verdict = verdictFor(score);
  if (!safety && (verdict === 'low' || verdict === 'medium')) verdict = 'unknown';

  flags.sort((a, b) => b.weight - a.weight);
  return { score, verdict, flags, hardBlock, hasSafetyData: safety !== null, top10Percent };
}
