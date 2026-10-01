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
