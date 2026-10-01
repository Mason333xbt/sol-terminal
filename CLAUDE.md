# sol-terminal

## Rules
- TypeScript, strict mode. No `any` in src/core or src/exec.
- Private keys live in .env and are only read in src/exec/signer.ts.
- Never log a key, a seed or a full signed transaction.
- Every trade function takes a `paper: boolean` and defaults to true.
- All external calls go through a rate limiter with retry + jitter.
- DexScreener: 300 req/min on pairs/tokens/search, 60 req/min on profiles/boosts.
- New feed or venue = new file in src/feeds or src/exec. Never patch Token for one source.
- Time in src/core and src/bot comes from store.now(), never Date.now(), or replay lies.
- The UI never renders feed text with innerHTML. Token names come from strangers.

## Commands
- npm run dev        -> tsx watch src/server.ts
- npm run record     -> live feeds, writes fixtures/YYYY-MM-DD.jsonl
- npm run fixture    -> regenerate the synthetic fixtures/sample.jsonl
- npm run replay     -> tsx test/replay.ts [fixtures/file.jsonl]
- npm run typecheck

## Done means
- typecheck passes, replay runs with zero unhandled rejections,
  and the UI shows feed, scores and positions.
