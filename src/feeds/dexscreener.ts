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
