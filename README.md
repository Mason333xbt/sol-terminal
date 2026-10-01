# SOL Terminal

A Solana memecoin trading terminal built with Claude Code. It reads pump.fun launches from PumpPortal, pulls liquidity and volume from DexScreener, throws out obvious rugs with on-chain checks, trades the bonding curve through PumpPortal and graduated tokens through Jupiter, and shows everything on one black-and-gold HTML screen.

Paper mode is the default. No key, no live trades, until you decide otherwise.

The full write-up with every design decision is in [ARTICLE.md](ARTICLE.md).

> Not financial advice. Memecoin trading can wipe a wallet fast. Use a burner wallet and size as if every trade goes to zero.

## Quick start

```bash
git clone <this repo> && cd sol-terminal
npm install
cp .env.example .env        # paper mode works with WALLET_SECRET_B58 left empty

npm run typecheck           # should print nothing
npm run fixture             # writes a synthetic test feed to fixtures/sample.jsonl
npm run replay              # bot runs on it, prints stats
npm run dev                 # live feeds, paper trades
```

Then open `ui/terminal.html` in your browser. It connects to `ws://127.0.0.1:8787` (use `?port=` for another port). Press `H` to hide controls for screen recording.

## How it fits together

```text
PumpPortal WS ──┐
DexScreener ────┼─> Token store + Gate 1 (cheap filters, score)
                │            │
Solana RPC ─────┴─> Gate 2 (mint/freeze authority, top holders)
                             │
                            Bot (entries, TP, stop, trailing, stale exit)
                ┌────────────┼──────────────────┐
     PumpPortal trade-local  Jupiter swap       Terminal UI (local WS)
       (bonding curve)       (after migration)
                └──────┬─────┘
                    Signer (key stays on your machine)
```

```text
src/
  core/   token model, store + clock, limiter, scoring, safety checks
  feeds/  pumpportal.ts (websocket), dexscreener.ts (poller)
  exec/   signer.ts, pump.ts, jupiter.ts, index.ts (router by stage)
  bot/    index.ts (loop), positions.ts (exits), paperFill.ts (cost model)
  server.ts
ui/terminal.html
test/replay.ts, test/make-fixture.ts
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Live feeds, auto-reload, paper unless `PAPER=false` |
| `npm run record` | Same, and writes every store event to `fixtures/YYYY-MM-DD.jsonl` |
| `npm run replay -- fixtures/2026-10-01.jsonl` | Replays a recorded day through the real bot code, prints win rate, avg win/loss, drawdown |
| `npm run fixture` | Regenerates `fixtures/sample.jsonl` |
| `npm run typecheck` | Strict TypeScript check |

`fixtures/sample.jsonl` (made by `npm run fixture`) is **synthetic** test data. It proves the pipeline runs end to end. Its stats say nothing about any strategy. Record real data with `npm run record` before you tune a single number.

Replay stubs Gate 2 (no RPC calls) and only exercises curve tokens offline. Paper trades on migrated tokens still ask Jupiter for a real quote, so they need `JUP_API_KEY` and network access.

## Going live

1. Run `npm run record` for a few days and replay it. Tune `RULES` in `src/core/score.ts` and `EXIT` in `src/bot/positions.ts`, one knob at a time.
2. Set the real fee numbers in `src/bot/paperFill.ts`. The venue fees there are placeholders.
3. Paper trade live (`npm run dev`) until paper results hold up after costs.
4. Put a burner wallet key in `.env`, set `PAPER=false`, keep `MAX_SOL_PER_TRADE` tiny.
5. Compare live fills with paper fills for a week and adjust `slipPct` before you scale.

Closing empty token accounts (about 0.002 SOL rent each) is not automated yet. See the costs section in the article.

## Notes

- Every code block in [ARTICLE.md](ARTICLE.md) is the exact file from this repo. The UI is shown trimmed there; the full page is `ui/terminal.html`.
- `ui/terminal.html` never renders token names with `innerHTML`. Names and symbols on pump.fun are chosen by strangers.
- Without `WALLET_SECRET_B58` the signer refuses every live send, so paper mode runs with zero setup.

## Sources

- [DexScreener API reference](https://docs.dexscreener.com/api/reference)
- [PumpPortal API](https://github.com/TrustPump/Pump-Fun-API)
- [Jupiter Swap API: Get Quote](https://jupiter.mintlify.app/docs/swap/get-quote)

Built by Mason333xbt with Claude Code. MIT license.
