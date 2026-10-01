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
