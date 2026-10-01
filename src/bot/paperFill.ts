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
