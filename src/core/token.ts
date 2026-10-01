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
