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
