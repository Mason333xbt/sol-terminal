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
