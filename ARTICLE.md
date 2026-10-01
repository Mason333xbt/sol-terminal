# Claude Code 2.1.286 Built Me a Solana Trading Terminal. Here's the Full Setup.

Oct 1, 2026 · @Young crypto Enthusiast

## You're still refreshing DexScreener by hand?

I built a Solana trading terminal with Claude Code 2.1.286. It catches every pump.fun launch the second it hits the chain. It pulls liquidity, volume and boosts from DexScreener. It kills obvious rugs before a single lamport moves. Then it buys, manages the exit and paints the whole thing on one black screen.

No $300/month sniper subscription. No Telegram bot that holds your keys. No dev who ghosts you after the first invoice.

You keep the keys. You keep the code. You keep the edge.

This article is the full build. Folder structure, the CLAUDE.md that keeps Claude on rails, the feed code, the rug filter, the execution layer for both the bonding curve and graduated tokens, the exit logic and the terminal UI. Copy the pieces, paste them into your own repo, and let Claude Code wire the rest.

Full code, type-checked and MIT-licensed: [github.com/Mason333xbt/sol-terminal](https://github.com/Mason333xbt/sol-terminal). Clone it, run `npm install`, `npm run fixture` and `npm run replay`, and the bot trades a synthetic feed on your machine in seconds. Every code block below is the exact file from that repo.

### What the terminal reads

| Source | Transport | What it gives the bot |
| --- | --- | --- |
| PumpPortal | WebSocket `wss://pumpportal.fun/api/data` | New pump.fun tokens, migrations, trades on watched mints |
| DexScreener | REST `api.dexscreener.com` | Pair price, liquidity, volume, txns, boosts, profiles |
| Solana RPC | JSON-RPC | Mint authority, freeze authority, top holders, balances |
| Jupiter | REST `api.jup.ag/swap/v1` | Quotes and swap transactions once a token leaves the curve |

One honest line before the code. This is a tool. It loses money as fast as it makes it if your filters are lazy. Start in paper mode. Section 7 shows how.

### Seven terms you need before the code

| Term | What it means here |
| --- | --- |
| Bonding curve | pump.fun's launch phase. You buy from and sell to the curve itself, and the price rises with every buy |
| Migration | When a curve fills, the token "graduates" into a regular pool. After that you trade it through a DEX aggregator like Jupiter |
| Mint authority | A key that can print more supply. Live mint authority = the dev can dilute you to zero |
| Freeze authority | A key that can freeze token accounts. Live freeze authority = you may never be able to sell |
| Lamports | The smallest unit of SOL. 1 SOL = 1,000,000,000 lamports |
| Slippage (bps) | How far the fill may drift from the quote. 100 bps = 1% |
| Priority fee | An extra tip in SOL so validators include your transaction faster when the chain is busy |

## At a glance

&#91;embedded content: terminal architecture · 3 feeds, 2 gates, 2 venues, 1 signer\]

Three feeds land in one store. Two gates throw out the junk. The bot routes each trade by stage, and only the signer ever touches your key.

## Setup: the stack and the repo Claude works in

The stack is boring on purpose. Node with TypeScript on the backend, one HTML file on the front, a local WebSocket between them. Boring stacks are the ones Claude Code writes without hallucinating glue.

```bash
mkdir sol-terminal && cd sol-terminal
npm init -y
npm i ws @solana/web3.js @solana/spl-token bs58 dotenv
npm i -D typescript tsx @types/ws @types/node
npx tsc --init

# Claude Code itself
npm install -g @anthropic-ai/claude-code
claude
```

### Folder structure

```text
sol-terminal/
  CLAUDE.md            # rules Claude reads every session
  .env.example         # copy to .env; .env is never committed
  src/
    feeds/
      pumpportal.ts    # websocket: launches, migrations, trades
      dexscreener.ts   # REST poller with a rate limiter
    core/
      token.ts         # one Token model for every source
      store.ts         # in-memory state, clock, event bus
      limiter.ts       # sliding-window rate limiter
      score.ts         # Gate 1: filters and scoring
      safety.ts        # Gate 2: on-chain rug checks
    exec/
      signer.ts        # local signing + send + confirm
      pump.ts          # bonding-curve trades via PumpPortal
      jupiter.ts       # graduated tokens via Jupiter
      index.ts         # router: picks the venue by stage
    bot/
      index.ts         # the loop: exits, then entries
      positions.ts     # TP, stop, trailing, stale, timeout
      paperFill.ts     # pessimistic paper cost model
    server.ts          # bot loop + local WS for the UI
  ui/
    terminal.html      # the screen
  test/
    replay.ts          # replays recorded feed data
    make-fixture.ts    # synthetic feed for smoke tests
  fixtures/            # recordings, git-ignored
```

Every folder answers one question. Where does data come from, what do we think about it, how do we trade it, how do we show it. When Claude knows where a thing lives, it stops inventing new files.

### CLAUDE.md

This file is the cheapest upgrade you'll ever make. Claude reads it at the start of each session, so your rules survive every new chat.

```markdown
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
```

The last two rules come from real bugs found while building the repo. Once they sit in CLAUDE.md, Claude checks every new file against them.

### .env

```bash
RPC_URL=https://your-rpc-provider/?api-key=XXXX
WALLET_SECRET_B58=...            # burner wallet, small balance
JUP_API_KEY=...
PAPER=true
MAX_SOL_PER_TRADE=0.05
MAX_OPEN_POSITIONS=5
```

Use a burner wallet with a small balance. The public RPC endpoint rate-limits hard and drops transactions under load, so a paid RPC is the first $ you spend.

## Feeds: pump.fun for speed, DexScreener for context

Two feeds, two jobs. PumpPortal tells you a token exists within moments of creation. DexScreener tells you whether anyone cares about it a few minutes later. One model holds both views, so the scorer never asks where a number came from.

### One Token model

```ts
// src/core/token.ts
export type Stage = "curve" | "migrated" | "dex";

export interface Token {
  mint: string;
  symbol: string;
  name: string;
  stage: Stage;
  createdAt: number;
  creator?: string;
  decimals?: number;          // pump.fun tokens use 6
  // the price the bot trades on, in SOL per whole token
  priceSol?: number;
  // curve data from PumpPortal
  marketCapSol?: number;
  devBuySol?: number;
  vSol?: number;              // virtual SOL in the curve
  vTokens?: number;           // virtual tokens in the curve
  // market data from DexScreener
  priceUsd?: number;
  liquidityUsd?: number;
  volM5?: number;
  buysM5?: number;
  sellsM5?: number;
  boosts?: number;
  hasProfile?: boolean;
  // our verdicts
  safety?: { ok: boolean; reasons: string[] };
  score?: number;
  updatedAt: number;
}
```

One rule saves you from mixed units: the bot trades on `priceSol` and nothing else. `priceUsd` is for the screen.

### The store

One in-memory map, one clock, one event bus. The clock is what lets replay run a day of data in seconds.

```ts
// src/core/store.ts
import { EventEmitter } from "events";
import type { Token } from "./token";

class Store extends EventEmitter {
  private tokens = new Map<string, Token>();
  clock: number | null = null;              // replay sets this, live leaves it null

  now() {
    return this.clock ?? Date.now();
  }

  upsert(t: Token) {
    const prev = this.tokens.get(t.mint);
    this.tokens.set(t.mint, { ...prev, ...t, updatedAt: this.now() });
    this.emit("record", { ts: this.now(), kind: "token", data: t });
    this.emit("token", t.mint);
  }

  patch(mint: string, data: Partial<Token>) {
    const cur = this.tokens.get(mint);
    if (!cur) return;                        // ignore tokens we never saw launch
    Object.assign(cur, data, { updatedAt: this.now() });
    this.emit("record", { ts: this.now(), kind: "patch", mint, data });
    this.emit("token", mint);
  }

  get(mint: string) {
    return this.tokens.get(mint);
  }

  activeMints(maxAgeMin = 60) {
    const cutoff = this.now() - maxAgeMin * 60_000;
    return [...this.tokens.values()].filter((t) => t.createdAt > cutoff).map((t) => t.mint);
  }

  latest(n: number) {
    return [...this.tokens.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, n);
  }

  ranked(n: number) {
    return [...this.tokens.values()]
      .filter((t) => t.score != null && t.safety?.ok !== false)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, n);
  }

  // drop old tokens so memory stays flat over a long session
  prune(keep: Set<string>, maxAgeMin = 120) {
    const cutoff = this.now() - maxAgeMin * 60_000;
    for (const [mint, t] of this.tokens) if (t.createdAt < cutoff && !keep.has(mint)) this.tokens.delete(mint);
  }
}

export const store = new Store();
```

Every change fires a `record` event too. `npm run record` writes those to disk, and that file is what replay feeds back in (section 9).

### The rate limiter

A sliding window. It remembers when each recent call went out and makes the next caller wait when the window is full, plus a little random jitter so bursts don't line up.

```ts
// src/core/limiter.ts
export function limiter(max: number, windowMs: number) {
  const stamps: number[] = [];
  return async function gate(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
      if (stamps.length < max) {
        stamps.push(now);
        return;
      }
      const wait = windowMs - (now - stamps[0]) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
    }
  };
}
```

### PumpPortal websocket

The data socket at `wss://pumpportal.fun/api/data` streams creation events for free. Per-token trade streams are metered, so subscribe only to mints that already passed your first filter.

```ts
// src/feeds/pumpportal.ts
import WebSocket from "ws";
import { store } from "../core/store";

// price on the curve = virtual SOL / virtual tokens
const curvePrice = (vSol: number, vTokens: number) => (vTokens > 0 ? vSol / vTokens : undefined);

export function startPumpPortal() {
  let ws: WebSocket;
  let retry = 1000;
  const watched = new Set<string>();

  const connect = () => {
    ws = new WebSocket("wss://pumpportal.fun/api/data");

    ws.on("open", () => {
      retry = 1000;
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      ws.send(JSON.stringify({ method: "subscribeMigration" }));
      // resubscribe after a reconnect, or open positions go blind
      if (watched.size) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [...watched] }));
    });

    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.txType === "create") {
        store.upsert({
          mint: m.mint,
          symbol: m.symbol,
          name: m.name,
          stage: "curve",
          decimals: 6,
          creator: m.traderPublicKey,
          devBuySol: m.solAmount,
          marketCapSol: m.marketCapSol,
          vSol: m.vSolInBondingCurve,
          vTokens: m.vTokensInBondingCurve,
          priceSol: curvePrice(m.vSolInBondingCurve, m.vTokensInBondingCurve),
          createdAt: store.now(),
          updatedAt: store.now(),
        });
      } else if (m.txType === "buy" || m.txType === "sell") {
        // every trade on a watched mint moves the curve price
        store.patch(m.mint, {
          vSol: m.vSolInBondingCurve,
          vTokens: m.vTokensInBondingCurve,
          marketCapSol: m.marketCapSol,
          priceSol: curvePrice(m.vSolInBondingCurve, m.vTokensInBondingCurve),
        });
      } else if (m.txType === "migrate" || m.method === "migration") {
        store.patch(m.mint, { stage: "migrated" });
      }
    });

    // the socket drops under load; reconnect with backoff
    ws.on("close", () => {
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30_000);
    });
    ws.on("error", () => ws.close());
  };

  connect();
  return {
    watch: (mints: string[]) => {
      mints.forEach((m) => watched.add(m));
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: mints }));
    },
  };
}
```

Why the curve price and not DexScreener's? DexScreener is polled every few seconds and indexes with a delay. On a curve token that can move 20% between two polls, a stop that reads stale prices fires late. Trade events arrive as the trades land, so stops on the curve read those.

Log a few raw messages before you trust the field names. Payload shapes shift, and Claude Code adapts the mapper in seconds once it sees a real sample.

### DexScreener poller

DexScreener has no push for pair data in its REST reference, so you poll. The tokens endpoint takes up to 30 addresses per call at 300 requests per minute. That's 9,000 token refreshes a minute, more than a single bot will ever need.

```ts
// src/feeds/dexscreener.ts
import { store } from "../core/store";
import { limiter } from "../core/limiter";

const BASE = "https://api.dexscreener.com";
const pairsLimit = limiter(250, 60_000);   // stay under 300/min
const profileLimit = limiter(50, 60_000);  // stay under 60/min

export async function refreshPairs() {
  const mints = store.activeMints();       // tokens worth watching
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30).join(",");
    await pairsLimit();
    const res = await fetch(`${BASE}/tokens/v1/solana/${batch}`);
    if (!res.ok) continue;
    const pairs: any[] = await res.json();

    // a token can trade on several pools; keep the deepest one
    const best = new Map<string, any>();
    for (const p of pairs) {
      const mint = p.baseToken.address;
      const cur = best.get(mint);
      if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(mint, p);
    }
    for (const [mint, p] of best) {
      const stage = p.dexId === "pumpfun" ? "curve" : "dex";
      const quotedInSol = p.quoteToken?.symbol === "SOL";
      store.patch(mint, {
        priceUsd: Number(p.priceUsd),
        liquidityUsd: p.liquidity?.usd,
        volM5: p.volume?.m5,
        buysM5: p.txns?.m5?.buys,
        sellsM5: p.txns?.m5?.sells,
        boosts: p.boosts?.active ?? 0,
        stage,
        // off the curve, DexScreener's native price (in SOL) is the trade price
        ...(stage === "dex" && quotedInSol ? { priceSol: Number(p.priceNative) } : {}),
      });
    }
  }
}

export async function refreshBoosts() {
  await profileLimit();
  const res = await fetch(`${BASE}/token-boosts/latest/v1`);
  const rows: any[] = await res.json();
  for (const r of rows) {
    if (r.chainId === "solana") store.patch(r.tokenAddress, { hasProfile: true });
  }
}

setInterval(refreshPairs, 3_000);
setInterval(refreshBoosts, 20_000);
```

Price ownership is split on purpose. On the curve, PumpPortal trade events set `priceSol`. After migration, DexScreener's `priceNative` sets it. Liquidity, volume and boosts always come from DexScreener.

Want a third or fourth venue? Same pattern. New file in `src/feeds`, map into `Token`, done. Extra sources plug in the same way, and the scorer never changes.

## Filters and rug checks: say no to 95% of launches

The money in this game comes from what you skip. Thousands of tokens launch on pump.fun every day, and most of them die in minutes. Your bot should be a bouncer first and a buyer second.

The pipeline runs in two gates. A cheap gate on every launch, using data you already have. An expensive on-chain gate only for survivors.

### Gate 1: cheap filters

```ts
// src/core/score.ts
import type { Token } from "./token";
import { store } from "./store";

export const RULES = {
  minAgeSec: 30,          // let the first bot wave clear
  maxAgeMin: 45,
  maxDevBuySol: 3,        // big dev bag = big dev dump
  minLiquidityUsd: 8_000,
  minBuysM5: 25,
  minBuySellRatio: 1.3,
};

export function passesGate1(t: Token): boolean {
  const ageSec = (store.now() - t.createdAt) / 1000;   // store clock, so replay ages tokens right
  if (ageSec < RULES.minAgeSec || ageSec > RULES.maxAgeMin * 60) return false;
  if ((t.devBuySol ?? 0) > RULES.maxDevBuySol) return false;
  if (t.stage !== "curve" && (t.liquidityUsd ?? 0) < RULES.minLiquidityUsd) return false;
  if ((t.buysM5 ?? 0) < RULES.minBuysM5) return false;
  const ratio = (t.buysM5 ?? 0) / Math.max(1, t.sellsM5 ?? 0);
  return ratio >= RULES.minBuySellRatio;
}

export function score(t: Token): number {
  const flow = Math.log1p(t.volM5 ?? 0) * 8;
  const ratio = Math.min(3, (t.buysM5 ?? 0) / Math.max(1, t.sellsM5 ?? 0)) * 10;
  const social = (t.hasProfile ? 10 : 0) + Math.min(20, (t.boosts ?? 0) * 2);
  const migratedBonus = t.stage === "dex" ? 10 : 0;
  return Math.round(flow + ratio + social + migratedBonus);
}
```

Note `store.now()` on the age line. The first version used `Date.now()`, and in replay every token looked days old, so the bot opened zero trades. One line, whole backtest dead.

These numbers are a starting point. They are not a strategy. Your replay data (section 9) tells you where to move them.

### Gate 2: on-chain safety

Three questions settle most rugs. Can someone still mint more supply? Can someone freeze your tokens so you can't sell? Do a few wallets hold most of what trades?

```ts
// src/core/safety.ts
import { PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { conn } from "../exec/signer";

export async function checkSafety(mint: string, ignore: string[] = []) {
  // replay runs offline: skip RPC, treat every token as passing Gate 2
  if (process.env.SAFETY_STUB === "1") return { ok: true, reasons: [], topPct: 0 };

  const reasons: string[] = [];
  const key = new PublicKey(mint);

  // works for both the classic token program and Token-2022
  const info = await conn.getAccountInfo(key);
  if (!info) return { ok: false, reasons: ["mint not found"] };
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const m = await getMint(conn, key, "confirmed", program);

  if (m.mintAuthority) reasons.push("mint authority still live");
  if (m.freezeAuthority) reasons.push("freeze authority still live");

  // top holders, minus pool and curve accounts you pass in
  const largest = await conn.getTokenLargestAccounts(key);
  const supply = Number(m.supply);
  const top = largest.value
    .filter((a) => !ignore.includes(a.address.toBase58()))
    .slice(0, 10)
    .reduce((s, a) => s + Number(a.amount), 0);
  const topPct = supply ? (top / supply) * 100 : 100;
  if (topPct > 35) reasons.push(`top 10 hold ${topPct.toFixed(1)}%`);

  return { ok: reasons.length === 0, reasons, topPct };
}
```

The `ignore` list matters. On the curve, the bonding curve account holds a huge slice of supply by design. After migration, the pool account does. Leave them in and every token looks like a rug.

Run Gate 2 only after Gate 1 passes. RPC calls cost money and time, and a launch that fails on buy pressure doesn't deserve them.

## Execution: two venues, one signer

A pump.fun token lives in two worlds. On the bonding curve you trade against the curve itself. After migration it trades in a pool, and Jupiter finds the best route. The bot checks `stage` and picks the venue. Both paths return a raw transaction that you sign on your own machine.

### The signer

The only file that touches your key. Everything else gets a function, never the secret.

```ts
// src/exec/signer.ts
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export const conn = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");

// paper mode runs without a real key: a throwaway keypair stands in, and it can never send
const secret = process.env.WALLET_SECRET_B58;
const ephemeral = !secret;
const wallet = secret ? Keypair.fromSecretKey(bs58.decode(secret)) : Keypair.generate();
if (ephemeral) console.warn("[signer] no WALLET_SECRET_B58: paper mode only");

export const owner = wallet.publicKey;
export const publicKey = owner.toBase58();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function signAndSend(tx: VersionedTransaction): Promise<string> {
  if (ephemeral) throw new Error("live trade refused: set WALLET_SECRET_B58 to trade live");
  tx.sign([wallet]);
  const raw = tx.serialize();

  // the blockhash this tx was BUILT with; it decides when the tx expires
  const blockhash = tx.message.recentBlockhash;

  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`tx failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;

    // once the blockhash expires, the tx can never land; stop waiting
    const { value: alive } = await conn.isBlockhashValid(blockhash, { commitment: "processed" });
    if (!alive) throw new Error(`expired before landing: ${sig}`);

    // rebroadcast the same signed bytes; duplicates are dropped by the network
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await sleep(1_500);
  }
  throw new Error(`confirm timeout: ${sig}`);
}
```

No key in `.env`? The signer swaps in a throwaway keypair so paper mode runs with zero setup, and refuses any live send. You can't trade real money by accident.

The common mistake is fetching a fresh blockhash after sending and confirming against that. The fresh one lives longer than the one inside your transaction, so the bot keeps waiting for a trade that already died. Here the loop checks the transaction's own blockhash and quits the moment it expires.

`skipPreflight: true` saves time on the first send, and you pay for it in clarity: a broken transaction fails on-chain instead of in simulation. While you're still in paper or tiny-size mode, flip it to `false` and read the simulation errors.

### Bonding curve via PumpPortal

PumpPortal's local trade endpoint builds the transaction and hands it back unsigned. Your key never leaves your box. Check their docs for the current fee per trade before you size anything.

```ts
// src/exec/pump.ts
import { VersionedTransaction } from "@solana/web3.js";
import { publicKey, signAndSend } from "./signer";

type Side = "buy" | "sell";

export async function pumpTrade(side: Side, mint: string, amount: number | string, paper = true) {
  if (paper) return `paper-${side}-${mint}-${Date.now()}`;

  const res = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey,
      action: side,
      mint,
      amount,                               // SOL on buys, token amount or "100%" on sells
      denominatedInSol: side === "buy" ? "true" : "false",
      slippage: 15,                         // percent
      priorityFee: 0.0005,                  // SOL
      pool: "pump",
    }),
  });
  if (res.status !== 200) throw new Error(`pumpportal ${res.status}: ${await res.text()}`);

  const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
  return signAndSend(tx);
}
```

### Graduated tokens via Jupiter

Jupiter's free `lite-api` host was scheduled for deprecation on 31 January 2026, so the code points at `api.jup.ag` with an API key. Quote first, then ask for the swap transaction built from that quote.

```ts
// src/exec/jupiter.ts
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { conn, owner, publicKey, signAndSend } from "./signer";

const JUP = "https://api.jup.ag/swap/v1";
export const SOL = "So11111111111111111111111111111111111111112";
const headers = { "x-api-key": process.env.JUP_API_KEY!, "Content-Type": "application/json" };

// Jupiter wants integers in the smallest unit: lamports for SOL,
// and amount x 10^decimals for tokens (pump.fun tokens use 6 decimals)
export const toRaw = (ui: number, decimals: number) =>
  (BigInt(Math.round(ui * 1e6)) * 10n ** BigInt(decimals)) / 1_000_000n;

export async function jupSwap(inputMint: string, outputMint: string, amountRaw: string, paper = true) {
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw,
    slippageBps: "800",
    restrictIntermediateTokens: "true",
  });
  const quote = await (await fetch(`${JUP}/quote?${q}`, { headers })).json();
  if (!quote?.outAmount) throw new Error("no route");
  if (paper) return { sig: `paper-jup-${Date.now()}`, outAmount: quote.outAmount as string };

  const swap = await (
    await fetch(`${JUP}/swap`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: publicKey,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    })
  ).json();

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
  return { sig: await signAndSend(tx), outAmount: quote.outAmount as string };
}

export const buyWithSol = (mint: string, lamports: number, paper = true) =>
  jupSwap(SOL, mint, String(lamports), paper);

// read the real balance in raw units, so a sell never asks for tokens you don't hold
export async function tokenBalanceRaw(mint: string): Promise<bigint> {
  const { value } = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  return value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

// fraction 0.5 = half the bag; paperRaw is the bag size the paper book tracks
export async function sellForSol(mint: string, fraction: number, paper = true, paperRaw = 0n) {
  const bag = paper ? paperRaw : await tokenBalanceRaw(mint);
  const amount = (bag * BigInt(Math.round(fraction * 10_000))) / 10_000n;
  if (amount === 0n) throw new Error(`nothing to sell for ${mint}`);
  return jupSwap(mint, SOL, amount.toString(), paper);
}
```

Decimals bite in one place: converting a human amount ("sell 1,250,000 tokens") into the integer Jupiter expects. Get it wrong by 10^6 and the quote either fails or sells a dust amount. Reading the raw balance from the chain sidesteps it for sells, and `toRaw` handles the rest without floating-point drift on big numbers.

### The router

```ts
// src/exec/index.ts
import type { Token } from "../core/token";
import { pumpTrade } from "./pump";
import { buyWithSol, sellForSol } from "./jupiter";

export async function buy(t: Token, sol: number, paper: boolean): Promise<string> {
  if (t.stage === "curve") return pumpTrade("buy", t.mint, sol, paper);
  return (await buyWithSol(t.mint, Math.round(sol * 1e9), paper)).sig;
}

// the stage is checked at SELL time, so a token that migrated mid-trade exits through Jupiter
export async function sell(t: Token, fraction: number, paper: boolean, paperRaw = 0n): Promise<string> {
  if (t.stage === "curve") return pumpTrade("sell", t.mint, `${Math.round(fraction * 100)}%`, paper);
  return (await sellForSol(t.mint, fraction, paper, paperRaw)).sig;
}
```

That's the whole execution layer. About 170 lines. Paste both API doc pages into Claude Code, point it at the signer rule in CLAUDE.md, and ask for this exact file layout.

## Position manager: the exit is the strategy

Anyone can buy. The PnL lives in the sell. Memecoins move 40% in a minute both ways, so the exit rules run on every price tick and never wait for you to wake up.

Three rules cover most of it. Take a chunk off at the first target. Trail the rest. Kill anything that sits flat too long.

```ts
// src/bot/positions.ts
import type { Token } from "../core/token";
import { store } from "../core/store";
import { sell } from "../exec";
import { paperSell } from "./paperFill";

export interface Position {
  mint: string;
  symbol: string;
  entry: number;        // all-in SOL paid per token, costs included
  peak: number;         // best priceSol seen
  sizeSol: number;
  tokensRaw: bigint;    // bag in raw units
  remaining: number;    // 1 = full, 0.5 = half sold, 0 = closed
  openedAt: number;
  realizedSol: number;  // SOL back from sells so far
  paper: boolean;
}

export const EXIT = {
  stopLoss: -0.25,      // -25% from entry
  tp1: 0.6,             // +60%: sell half
  trail: 0.22,          // after tp1, exit 22% under the peak
  maxHoldMin: 20,       // flat and old = out
  staleMin: 5,          // no price update for this long = the feed died, get out
};

type Log = (s: string) => void;

export async function onTick(p: Position, t: Token, log: Log) {
  if (!t.priceSol || p.remaining === 0) return;
  const px = t.priceSol;
  p.peak = Math.max(p.peak, px);
  const pnl = px / p.entry - 1;
  const fromPeak = px / p.peak - 1;
  const ageMin = (store.now() - p.openedAt) / 60_000;

  if ((store.now() - t.updatedAt) / 60_000 > EXIT.staleMin) return exit(p, t, 1, `STALE ${pct(pnl)}`, log);
  if (pnl <= EXIT.stopLoss) return exit(p, t, 1, `STOP ${pct(pnl)}`, log);
  if (p.remaining === 1 && pnl >= EXIT.tp1) return exit(p, t, 0.5, `TP1 ${pct(pnl)}`, log);
  if (p.remaining < 1 && fromPeak <= -EXIT.trail) return exit(p, t, 1, `TRAIL ${pct(pnl)}`, log);
  if (ageMin > EXIT.maxHoldMin && Math.abs(pnl) < 0.1) return exit(p, t, 1, `TIMEOUT ${pct(pnl)}`, log);
}

// fraction is a share of what is LEFT: 0.5 = half the current bag, 1 = everything
export async function exit(p: Position, t: Token, fraction: number, why: string, log: Log) {
  const soldRaw = (p.tokensRaw * BigInt(Math.round(fraction * 10_000))) / 10_000n;
  const sig = await sell(t, fraction, p.paper, p.tokensRaw);

  if (p.paper && t.priceSol) {
    const ui = Number(soldRaw) / 10 ** (t.decimals ?? 6);
    p.realizedSol += paperSell(ui, t.priceSol, t.stage);
  }
  // live mode: read your SOL balance before and after the sell for realized PnL

  p.tokensRaw -= soldRaw;
  p.remaining = fraction >= 1 ? 0 : p.remaining * (1 - fraction);
  log(`${why} ${t.symbol} ${sig.slice(0, 12)}`);
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
```

The `STALE` rule runs first for a reason. A token that stops trading stops sending prices, so no other rule ever fires and the position hangs open forever. The first replay showed exactly that: most of the bags never closed.

Sells go through the router from section 6, which checks `stage` at sell time. A token that migrated while you held it exits through Jupiter without any special case here.

### The bot loop

This is the file that ties everything together: exits first, then entries, with Gate 2 running once per token.

```ts
// src/bot/index.ts
import { store } from "../core/store";
import { passesGate1, score } from "../core/score";
import { checkSafety } from "../core/safety";
import { buy } from "../exec";
import { tokenBalanceRaw } from "../exec/jupiter";
import { onTick, exit, type Position } from "./positions";
import { paperBuy } from "./paperFill";

const SIZE_SOL = Number(process.env.MAX_SOL_PER_TRADE ?? 0.05);
const MAX_OPEN = Number(process.env.MAX_OPEN_POSITIONS ?? 5);
const ENTRY_SCORE = 60;

class Bot {
  paper = process.env.PAPER !== "false";
  log: string[] = [];
  private open = new Map<string, Position>();
  private closed: Position[] = [];
  private checked = new Set<string>();
  private say = (s: string) => {
    this.log.push(s);
    if (this.log.length > 500) this.log.shift();
  };

  async step() {
    // 1. exits first: protecting open bags beats finding new ones
    for (const p of this.open.values()) {
      const t = store.get(p.mint);
      if (t) await onTick(p, t, this.say);
      if (p.remaining === 0) {
        this.open.delete(p.mint);
        this.closed.push(p);
      }
    }

    // 2. entries
    for (const mint of store.activeMints(45)) {
      if (this.open.size >= MAX_OPEN) return;
      const t = store.get(mint)!;
      if (this.open.has(mint) || this.checked.has(mint) || !t.priceSol) continue;
      if (!passesGate1(t)) continue;
      t.score = score(t);
      if (t.score < ENTRY_SCORE) continue;

      this.checked.add(mint);                   // Gate 2 runs once per token
      t.safety = await checkSafety(mint, []);   // pass the curve or pool account here
      if (!t.safety.ok) {
        this.say(`SKIP ${t.symbol}: ${t.safety.reasons.join(", ")}`);
        continue;
      }
      await this.enter(mint);
    }
  }

  async enter(mint: string) {
    const t = store.get(mint);
    if (!t?.priceSol || this.open.has(mint)) return;
    const sig = await buy(t, SIZE_SOL, this.paper);

    let tokensRaw: bigint;
    let entry: number;
    if (this.paper) {
      ({ tokensRaw, entry } = paperBuy(SIZE_SOL, t.priceSol, t.stage, t.decimals ?? 6));
    } else {
      tokensRaw = await tokenBalanceRaw(mint);          // what actually landed
      entry = SIZE_SOL / (Number(tokensRaw) / 10 ** (t.decimals ?? 6));
    }

    this.open.set(mint, {
      mint, symbol: t.symbol, entry, peak: t.priceSol, sizeSol: SIZE_SOL,
      tokensRaw, remaining: 1, openedAt: store.now(), realizedSol: 0, paper: this.paper,
    });
    store.emit("watch", mint);   // server.ts subscribes PumpPortal trades for this mint
    this.say(`BUY ${t.symbol} ${SIZE_SOL} SOL ${sig.slice(0, 12)}`);
  }

  manualBuy = (mint: string) => this.enter(mint);

  async closeAll(why: string) {
    for (const p of this.open.values()) {
      const t = store.get(p.mint);
      if (t) await exit(p, t, 1, why, this.say);
    }
  }

  positions() {
    return [...this.open.values()].map((p) => ({
      mint: p.mint,
      symbol: p.symbol,
      pnl: (store.get(p.mint)?.priceSol ?? p.entry) / p.entry - 1,
    }));
  }

  pnl() {
    return this.closed.reduce((s, p) => s + p.realizedSol - p.sizeSol, 0);
  }

  stats() {
    const r = this.closed.map((p) => p.realizedSol - p.sizeSol);
    const wins = r.filter((x) => x > 0), losses = r.filter((x) => x <= 0);
    const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    let eq = 0, peak = 0, maxDD = 0;
    for (const x of r) { eq += x; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }
    return {
      trades: r.length,
      winRate: r.length ? +(wins.length / r.length * 100).toFixed(1) : 0,
      avgWinOverLoss: losses.length ? +(avg(wins) / Math.abs(avg(losses) || 1)).toFixed(2) : 0,
      maxDrawdownSol: +maxDD.toFixed(4),
      netSol: +eq.toFixed(4),
    };
  }
}

export const bot = new Bot();
```

`server.ts` (next section) drives this loop every 500 ms and subscribes PumpPortal trades for every mint the bot buys. Replay calls `bot.step()` itself, so the loop never runs twice.

### Paper mode first, always

The `paper` flag runs the full pipeline with no transaction sent. Same feeds, same filters, same exits. The only fake part is the fill, and the next block makes it a pessimistic fake. Run it for a few days. Then look at three numbers from `bot.stats()` before you flip `PAPER=false`:

| Metric | Why it matters |
| --- | --- |
| Win rate | Below 30% with this exit set usually means the entry filter is too loose |
| Avg win / avg loss | You need this above 1.5 to survive fees and slippage |
| Max drawdown in SOL | The number that tells you how big a live size you can stomach |

### Paper fills that don't flatter you

A paper bot that fills at the quoted price always looks like a genius. Real fills pay a venue fee, an API fee on curve trades, a priority fee and price impact on thin liquidity. This model charges all four, so paper results come out a bit worse than reality instead of a lot better.

```ts
// src/bot/paperFill.ts
import type { Stage } from "../core/token";
import { toRaw } from "../exec/jupiter";

// Set these from the CURRENT fee pages before trusting any paper result.
export const COSTS = {
  venueFeePct: { curve: 1.0, dex: 0.3 },  // placeholders: pump.fun curve fee, pool fee
  apiFeePct: { curve: 0.5, dex: 0 },      // PumpPortal lists 0.5% per trade
  slipPct: { curve: 4, dex: 1.5 },        // assumed price impact; tune from live fills
  priorityFeeSol: 0.0005,                 // what pump.ts sends per trade
};

const kind = (s: Stage) => (s === "curve" ? "curve" : "dex");

export function paperBuy(sol: number, priceSol: number, stage: Stage, decimals: number) {
  const k = kind(stage);
  const fees = (COSTS.venueFeePct[k] + COSTS.apiFeePct[k]) / 100;
  const spend = (sol - COSTS.priorityFeeSol) * (1 - fees);
  const fillPrice = priceSol * (1 + COSTS.slipPct[k] / 100);   // you pay up
  const tokens = spend / fillPrice;
  return { tokensRaw: toRaw(tokens, decimals), entry: sol / tokens }; // all-in cost per token
}

export function paperSell(tokens: number, priceSol: number, stage: Stage) {
  const k = kind(stage);
  const fees = (COSTS.venueFeePct[k] + COSTS.apiFeePct[k]) / 100;
  const fillPrice = priceSol * (1 - COSTS.slipPct[k] / 100);   // you get less
  return tokens * fillPrice * (1 - fees) - COSTS.priorityFeeSol;
}
```

After the first week live, compare real fills with these numbers and adjust `slipPct`. The goal is a paper book that predicts the live one within a few percent. Until it does, any paper win rate is fiction.

Size small, compare live fills with paper fills for a week, and only then scale.

## The terminal: one HTML file, live over a socket

The screen is the part people screenshot, so it gets the same care as the bot. One HTML file, no framework, fed by a local WebSocket. Open it in a browser tab and it lights up.

The UI never talks to Solana and never sees a key. It reads state and sends two commands: buy and panic sell. That split keeps a careless click from becoming a careless transaction.

### Server side

```ts
// src/server.ts
import "dotenv/config";                  // must load before any module reads process.env
import { WebSocketServer } from "ws";
import { appendFileSync, mkdirSync } from "fs";
import { store } from "./core/store";
import { startPumpPortal } from "./feeds/pumpportal";
import "./feeds/dexscreener";
import { bot } from "./bot";

const PORT = Number(process.env.PORT ?? 8787);
const pumpportal = startPumpPortal();

// open positions need live curve prices: subscribe their trade stream
store.on("watch", (mint: string) => pumpportal.watch([mint]));

// RECORD=1 writes every store event to fixtures/ for replay later
if (process.env.RECORD === "1") {
  mkdirSync("fixtures", { recursive: true });
  const file = `fixtures/${new Date().toISOString().slice(0, 10)}.jsonl`;
  store.on("record", (e: unknown) => appendFileSync(file, JSON.stringify(e) + "\n"));
  console.log(`[record] writing ${file}`);
}

// the bot loop: exits first, then entries
setInterval(() => {
  bot.step().catch((e: Error) => bot.log.push("ERR " + e.message));
}, 500);

// keep memory flat on long sessions
setInterval(() => store.prune(new Set(bot.positions().map((p) => p.mint))), 60_000);

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
console.log(`[ui] ws://127.0.0.1:${PORT}  open ui/terminal.html  mode=${bot.paper ? "PAPER" : "LIVE"}`);

// push a compact snapshot 4 times a second
setInterval(() => {
  const snap = JSON.stringify({
    type: "snap",
    feed: store.latest(40),
    watch: store.ranked(15),
    positions: bot.positions(),
    pnl: bot.pnl(),
    log: bot.log.slice(-30),
    paper: bot.paper,
  });
  wss.clients.forEach((c) => c.readyState === 1 && c.send(snap));
}, 250);

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const cmd = JSON.parse(raw.toString());
      if (cmd.type === "buy" && typeof cmd.mint === "string") bot.manualBuy(cmd.mint).catch((e: Error) => bot.log.push("ERR " + e.message));
      if (cmd.type === "panic") bot.closeAll("PANIC").catch((e: Error) => bot.log.push("ERR " + e.message));
    } catch {
      /* ignore malformed commands */
    }
  });
});
```

Bind to `127.0.0.1`. A trading server open on `0.0.0.0` is an invitation.

### Client side

```html
<!-- ui/terminal.html (trimmed: styles, the HIDE toggle and reconnect live in the repo) -->
<body>
  <header>
    <b>SOL TERMINAL</b>
    <span id="mode"></span>
    <span id="pnl">0.000 SOL</span>
    <button id="panic">PANIC SELL</button>
  </header>
  <main>
    <section><h2>LAUNCHES</h2><ul id="feed"></ul></section>
    <section><h2>WATCHLIST</h2><table><tbody id="watch"></tbody></table></section>
    <section><h2>POSITIONS</h2><table><tbody id="pos"></tbody></table><pre id="log"></pre></section>
  </main>
<script>
  // Token names and symbols come from strangers on pump.fun.
  // Never put them into innerHTML: build nodes and set textContent.
  const $ = (id) => document.getElementById(id);
  const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;      // base58 address shape
  const usd = (n) => (n == null ? "-" : "$" + Math.round(n).toLocaleString());

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }

  const ws = new WebSocket("ws://127.0.0.1:8787");
  ws.onmessage = (e) => {
    const s = JSON.parse(e.data);
    $("mode").textContent = s.paper ? "PAPER" : "LIVE";
    $("pnl").textContent = (s.pnl >= 0 ? "+" : "") + s.pnl.toFixed(3) + " SOL";
    $("pnl").className = s.pnl >= 0 ? "up" : "down";

    $("feed").replaceChildren(...s.feed.map((t) => {
      const li = el("li", null, t.safety?.ok === false ? "bad" : "");
      li.append(el("span", t.symbol), el("i", t.stage));
      return li;
    }));

    $("watch").replaceChildren(...s.watch.map((t) => {
      const tr = el("tr");
      tr.append(el("td", t.symbol), el("td", t.score), el("td", usd(t.liquidityUsd)),
                el("td", `${t.buysM5 ?? 0}/${t.sellsM5 ?? 0}`));
      const td = el("td");
      if (MINT.test(t.mint)) {
        const b = el("button", "BUY");
        b.onclick = () => ws.send(JSON.stringify({ type: "buy", mint: t.mint }));
        td.append(b);
      }
      tr.append(td);
      return tr;
    }));

    $("pos").replaceChildren(...s.positions.map((p) => {
      const tr = el("tr");
      tr.append(el("td", p.symbol), el("td", (p.pnl * 100).toFixed(1) + "%", p.pnl >= 0 ? "up" : "down"));
      return tr;
    }));
    $("log").textContent = s.log.slice().reverse().join("\n");
  };

  $("panic").onclick = () => confirm("Close everything?") && ws.send(JSON.stringify({ type: "panic" }));
</script>
</body>
```

Read the comment at the top of the script twice. Anyone can launch a pump.fun token and name it with a chunk of HTML. Drop that name into `innerHTML` and the code runs inside the one page on your machine that has a BUY button. Every value from the feed goes through `textContent`, and the BUY button only exists for strings shaped like a real Solana address.

That's the skeleton. The look is where Claude Code earns its keep. I asked for a black-and-gold desk with flashing rows on new launches, a gold glow on fresh highs, red pulses on stops and a clean HIDE mode for screen recording. It came back as one file I could open straight away.

Two rules from my build: no clock on screen (it dates every screenshot) and no third-party scripts (a trading page has no business loading code you didn't read).

## How I drove Claude Code: prompts that ship, loops that catch bugs

Claude Code lives in your terminal, reads the repo, runs commands and edits files. You stop pasting snippets into a chat window and start giving a junior dev with infinite patience a ticket. The quality of the ticket decides the quality of the code.

### The build order

One layer per session. Each layer gets tested before the next one starts.

1. Token model + store. Nothing else.
2. PumpPortal feed. Start `npm run record` on day one, so every event lands in `fixtures/`.
3. DexScreener poller with the limiter.
4. Score + safety, run against the recordings.
5. Execution in paper mode only.
6. Position manager + replay test.
7. Server + terminal UI.
8. Live mode behind the `PAPER` flag, with a size cap.

Skip the order and you get a 900-line `index.ts` that nobody, including Claude, wants to debug.

### Prompts that worked

Short, specific, with a definition of done. Three real shapes:

```text
Read CLAUDE.md and src/core/token.ts.
Write src/feeds/dexscreener.ts: poll /tokens/v1/solana in batches of 30,
keep the deepest pool per mint, map into Token via store.patch.
Use limiter(250, 60000). No new types outside token.ts.
Done = npm run typecheck passes and a 2-minute run logs patched mints.
```

```text
The safety check rejects every curve token. Here are 5 log lines.
Find why, fix it, and add a test in test/safety.test.ts that would have caught it.
Don't touch score.ts.
```

```text
Run npm run replay on fixtures/day1.jsonl.
Report: trades, win rate, avg win/avg loss, max drawdown.
Then propose ONE change to RULES or EXIT and rerun. Show both results side by side.
```

The last one is the real unlock. Claude runs the replay, reads the numbers, changes one knob and runs it again. You review a diff and two tables instead of babysitting a backtest.

### The replay harness

Record the live feed once, replay it forever. Same code path as live, with time sped up.

```ts
// test/replay.ts
import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { store } from "../src/core/store";
import { bot } from "../src/bot";

const file = process.argv[2] ?? "fixtures/sample.jsonl";
process.env.SAFETY_STUB = "1";            // no RPC calls during replay
if (!existsSync(file)) {
  console.error(`${file} not found. Run \`npm run fixture\` for the synthetic sample, or \`npm run record\` for real data.`);
  process.exit(1);
}
const events = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

bot.paper = true;
let errors = 0;
process.on("unhandledRejection", () => errors++);

for (const e of events) {
  store.clock = e.ts;                      // the store uses this instead of Date.now()
  if (e.kind === "token") store.upsert(e.data);
  if (e.kind === "patch") store.patch(e.mint, e.data);
  await bot.step();                        // score, safety stub, entries, exits
}

// close whatever is still open at the last price, so stats count every trade
await bot.closeAll("END");
await bot.step();

console.table(bot.stats());
console.log("unhandled rejections:", errors);
process.exit(errors ? 1 : 0);
```

`SAFETY_STUB` skips the RPC calls, so a full day of recordings replays in seconds without touching your RPC bill. Every clock read in `src/core` and `src/bot` goes through `store.now()`, and replay sets `store.clock` to each event's timestamp. That's how token ages and hold times come out right.

The repo also ships `npm run fixture`, which writes a synthetic feed for smoke tests. It proves the pipeline runs end to end. Its stats say nothing about any strategy, so record real data before you tune a single number.

### Habits that saved hours

- Ask for a plan before any change that touches more than two files.
- Make Claude run `typecheck` and the replay after every edit, and paste the output back.
- One feature per commit. Claude writes the message, you read the diff.
- When it starts guessing field names, stop it and paste a real payload. Guesses cost more than samples.

## What one trade actually costs

Small size feels safe. On Solana memecoins it's where fees hurt most, because half the costs are flat. Here is a round trip (buy, then sell) at the 0.05 SOL size from `.env`, using the settings in this article.

| Cost | Per trade | Round trip on 0.05 SOL | Notes |
| --- | --- | --- | --- |
| PumpPortal fee | 0.5% of the trade | 0.0005 SOL | Curve trades only, per their docs |
| Priority fee | 0.0005 SOL, flat | 0.001 SOL | Set in `pump.ts`; Jupiter's "auto" varies |
| Base network fee | 5,000 lamports per signature | 0.00001 SOL | Tiny, always there |
| Venue fee | Curve or pool fee | varies | Check the current pump.fun and pool fee pages |
| Slippage | Price impact | varies | Often the biggest cost on thin curves |
| Token account rent | about 0.002 SOL on the first buy of a token | locked, not spent | Refunded when you close the empty account |

The fixed part alone comes to about 0.0015 SOL, or 3% of a 0.05 SOL round trip, before venue fees and slippage. Your strategy has to beat that on average just to break even. Double the size and that drag halves. That's the math behind "size small" having a floor.

The rent line is a quiet leak. Every new token you buy opens an account that holds about 0.002 SOL. Sell the bag and the empty account keeps the SOL until you close it. Fifty trades a day without cleanup parks about 0.1 SOL in dead accounts. Ask Claude Code for a `closeEmptyAccounts()` job that runs every hour, and add it to the replay checklist.

Monthly costs sit outside the table: a paid RPC plan and a Jupiter API key plan. Both depend on your provider and volume, so price them before you count any profit.

## The playbook

A dozen small files. One HTML screen. One CLAUDE.md that keeps the machine honest. That's the whole terminal.

1. Install Claude Code, create the repo, write CLAUDE.md before any code.
2. Build one layer per session in the order above. Record raw feed data from day one.
3. Two gates: cheap filters on every launch, on-chain checks on survivors.
4. Two venues, one signer: PumpPortal on the curve, Jupiter after migration, keys only in `signer.ts`.
5. The exit is the strategy: stop, half at TP1, trail the rest, time out the flat ones.
6. Paper mode until the replay numbers hold up. Then live, tiny size, burner wallet.
7. Let Claude tune one knob at a time against replay. Never two.

The people still clicking through DexScreener tabs at 3 AM are trading against bots built exactly like this. Now you have the blueprint for yours.

All of it is on GitHub: [github.com/Mason333xbt/sol-terminal](https://github.com/Mason333xbt/sol-terminal). Fork it, run it in paper mode, and break it there before it breaks your wallet.

Not financial advice. Memecoin trading can wipe a wallet fast. Size as if every trade goes to zero.

### Sources

- [sol-terminal on GitHub](https://github.com/Mason333xbt/sol-terminal) (full code from this article)
- [DexScreener API reference](https://docs.dexscreener.com/api/reference) (endpoints and rate limits)
- [PumpPortal trading and data API](https://github.com/TrustPump/Pump-Fun-API) (websocket methods, trade-local, fees)
- [Jupiter Get Quote docs](https://jupiter.mintlify.app/docs/swap/get-quote) (api.jup.ag, lite-api deprecation)
- [Helius: Jupiter Swap API guide](https://www.helius.dev/docs/sending-transactions/jupiter-swap-api-via-sender) (quote then swap flow)
