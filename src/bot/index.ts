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
