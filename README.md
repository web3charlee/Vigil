# Vigil (working name): multi-chain token risk scanner for Telegram

Paste a contract address, get a risk card in seconds: honeypot and tax checks, liquidity, holder
concentration, LP lock, contract red flags, and a 0-100 risk score with a clear verdict. Works across
14 EVM chains plus Solana (market data only). This is **Phase 1**: scanner, growth loop, and the
foundation the trading engine plugs into. See `docs/PHASE2.md` for execution.

Rename it in one place: `src/brand.ts`.

## Run it (5 minutes)

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token.
2. `cp .env.example .env` and paste the token into `BOT_TOKEN`.
3. `npm install`
4. **Verify against the live APIs first:** `npm run smoke -- 0x<any token address>`
   You should see a full card and `contract safety data: received`.
5. `npm run dev`, then message your bot.

Optional env: `ADMIN_ID` (your Telegram user id, unlocks `/stats`), `SCANS_PER_MINUTE`, `DATA_FILE`.

## What users get

| Feature | How |
| --- | --- |
| Auto-scan | Paste any address in a private chat |
| Group scanning | `/scan <address>` (add the bot to trader groups: free distribution) |
| Multi-chain detection | Picks the chain with the deepest liquidity, one-tap switch to other chains |
| Risk limit | `/settings`: Strict 40 / Balanced 60 / Degen 80. Cards say whether the bot "would block" the buy. Phase 2 enforces it |
| Share button | Every card has a share link back to the bot |
| Referrals | `/ref` gives an invite link; counts invited users |
| Admin stats | `/stats` (admin only): users, scans, referred users |

## Layout

```
src/scanner/   dexscreener.ts (market data) · goplus.ts (contract safety) · risk.ts (scoring) · index.ts (orchestrator)
src/bot/       bot.ts (handlers) · format.ts (cards, keyboards) · store.ts (users/referrals) · limiter.ts
src/chains.ts  chain registry: add a chain with one line
test/          72 offline tests (scoring, parsing, formatting, bot wiring, regression tests for live false positives)
```

Scoring lives in one pure function (`src/scanner/risk.ts`). Weights are my starting calibration, not
gospel: tune them against tokens you know turned out good or bad.

## Deploy

- **Docker:** `docker build -t vigil . && docker run -d --env-file .env -v $(pwd)/data:/app/data vigil`
- Any small VPS or container host works (Railway, Fly.io, Render). One instance, long polling, no
  public URL needed. Mount `data/` so users and referrals survive restarts.

## Known limits (read before launching)

- **Live checks so far:** scans of WETH (Base), PEPE (Ethereum) and wrapped SOL returned real data from
  both providers. Parsers were also checked against DexScreener's official API reference (pair field
  names match) and GoPlus's published list: all 12 EVM chain IDs here are on it. Chains other than
  Ethereum and Base have not been scanned live yet, so scan one token on every chain you plan to
  advertise. If a score looks wrong, run `npm run smoke -- <address> --debug` and send the output.
- **DexScreener lookup:** the cross-chain endpoint `/latest/dex/tokens/{address}` is no longer in
  their official reference, so it is treated as best-effort and the documented
  `/latest/dex/search?q=` endpoint is the automatic fallback (search returns a limited number of pairs).
- **Solana is market-data only.** No honeypot/tax/authority checks yet, so Solana cards are marked
  UNVERIFIED rather than "low risk". Adding a Solana safety provider is the next scanner task.
- **Chains GoPlus doesn't cover** degrade to the same "unverified" card instead of failing.
- **LP lock %** is computed from the top LP holders GoPlus reports and only counted for v2-style pools.
  For v3/v4-style pools it is skipped (shown as n/a), because liquidity there is a position, not a
  lockable token.
- **Renounced ownership.** Owner-only powers (pause, blacklist, mint, tax changes) collapse into one
  low-weight note when ownership is renounced. They still count in full if ownership can be reclaimed,
  is hidden, or is unknown. Role-based admin (not the owner role) can slip past this, so treat a low
  score as "no red flags found", never as "safe".
- **Contract holders.** A contract holding a big share (pool, bridge, vault, multisig) gets an info
  note instead of a whale warning.
- **Third-party rate limits.** Free tiers of both APIs are rate limited. There is a 60s cache and a
  per-user limiter; get API keys or add a shared cache before real traffic.
- **Single process + JSON file store.** Fine for the first few thousand users. Move to Postgres and
  webhooks after that.
- **Scores are heuristics.** The card says so; keep that disclaimer.

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm test` · `npm run typecheck` · `npm run smoke -- <address> [--debug]`
