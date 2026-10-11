# Phase 2: trading without custody

Goal: users trade from Telegram, the bot **can trade but cannot withdraw**, and every buy goes
through the risk gate from Phase 1. Nothing here is built yet. This is the design and the checklist.

## Why not just hold keys like the big bots

A bot that generates and stores user wallets is one breach away from draining every user. Being
non-custodial is the product's headline, so the design starts from that.

## Architecture (EVM)

1. **Smart account per user per chain.** The user's own wallet (or passkey) is the owner. Use a
   modular smart account with session keys (ERC-4337 / ERC-7579 families such as Kernel, Safe with a
   session-key module, or Nexus; compare current docs and audits before choosing).
2. **Session key = the bot's only power.** Policy, enforced on-chain by the account:
   - allowed target: the chosen swap router per chain, nothing else
   - allowed function: swap only; no `transfer`, no `approve` to arbitrary spenders, no withdrawals
   - spend caps: per trade and per day; expiry (e.g. 7 days), renewable by the owner
   - withdrawals require the owner's signature, never the session key
3. **Routing + fee.** Quote through aggregators (0x, 1inch, Velora/ParaSwap, OpenOcean, Kyber) and
   take the best. For the fee, prefer an aggregator's built-in fee parameter (check current docs per
   aggregator) over writing your own fee contract: no custom contract means nothing to audit or
   exploit. A custom router only if you can afford an audit.
4. **Risk gate before every buy.** Run `scanToken`, refuse if `hardBlock` or `score >= user.maxRisk`,
   and **re-check immediately before sending** (taxes and ownership can change between scan and buy).
5. **MEV protection.** Send through private/protected RPC where available (e.g. Flashbots Protect on
   Ethereum; per-chain equivalents elsewhere). Set sane slippage defaults.
6. **Automated exits.** A watcher service tracks positions and fires session-key swaps for ladder
   take-profits, trailing stops, and a one-tap panic exit. Exits must work if the user is offline.
7. **Copy trading.** Index swaps for tracked wallets (provider webhooks or an indexer such as Goldsky,
   Envio, or Dune), then rank wallets by PnL **after realistic delay and slippage**.
8. **Mini App.** Next.js + Telegram WebApp SDK. Verify `initData` signatures server-side. Owner
   signing via WalletConnect/Reown or passkeys.

## Solana

Different model. Start with "bot builds the transaction (Jupiter), user signs in their wallet" and
only consider delegated signing later. Add a Solana safety provider to the scanner first.

## Before any real money

- [ ] Testnet end to end, then mainnet with a tiny hard cap per user
- [ ] Independent review of the session-key policy config (and any custom contract: a full audit)
- [ ] Session-key signer in a KMS/HSM or equivalent, never in a `.env` file
- [ ] Global kill switch, per-user caps, alerting on abnormal volume
- [ ] Legal advice for your jurisdictions: non-custodial reduces but does not remove licensing risk
- [ ] Clear risk disclosures in the bot and ToS

## Realistic effort

Weeks, not a sitting: session-key account integration and its edge cases, per-chain router and RPC
setup, and testing with small real funds are the long poles.
