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
