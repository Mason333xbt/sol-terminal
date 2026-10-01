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
