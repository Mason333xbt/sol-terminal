// src/exec/jupiter.ts
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { conn, owner, publicKey, signAndSend } from "./signer";

const JUP = "https://api.jup.ag/swap/v1";
export const SOL = "So11111111111111111111111111111111111111112";
const headers = { "x-api-key": process.env.JUP_API_KEY!, "Content-Type": "application/json" };

// Jupiter wants integers in the smallest unit: lamports for SOL,
// and amount x 10^decimals for tokens (pump.fun tokens use 6 decimals)
export const toRaw = (ui: number, decimals: number) =>
  (BigInt(Math.round(ui * 1e6)) * 10n ** BigInt(decimals)) / 1_000_000n;

export async function jupSwap(inputMint: string, outputMint: string, amountRaw: string, paper = true) {
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw,
    slippageBps: "800",
    restrictIntermediateTokens: "true",
  });
  const quote = await (await fetch(`${JUP}/quote?${q}`, { headers })).json();
  if (!quote?.outAmount) throw new Error("no route");
  if (paper) return { sig: `paper-jup-${Date.now()}`, outAmount: quote.outAmount as string };

  const swap = await (
    await fetch(`${JUP}/swap`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: publicKey,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    })
  ).json();

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
  return { sig: await signAndSend(tx), outAmount: quote.outAmount as string };
}

export const buyWithSol = (mint: string, lamports: number, paper = true) =>
  jupSwap(SOL, mint, String(lamports), paper);

// read the real balance in raw units, so a sell never asks for tokens you don't hold
export async function tokenBalanceRaw(mint: string): Promise<bigint> {
  const { value } = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  return value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

// fraction 0.5 = half the bag; paperRaw is the bag size the paper book tracks
export async function sellForSol(mint: string, fraction: number, paper = true, paperRaw = 0n) {
  const bag = paper ? paperRaw : await tokenBalanceRaw(mint);
  const amount = (bag * BigInt(Math.round(fraction * 10_000))) / 10_000n;
  if (amount === 0n) throw new Error(`nothing to sell for ${mint}`);
  return jupSwap(mint, SOL, amount.toString(), paper);
}
