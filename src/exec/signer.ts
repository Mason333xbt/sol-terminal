// src/exec/signer.ts
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export const conn = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");

// paper mode runs without a real key: a throwaway keypair stands in, and it can never send
const secret = process.env.WALLET_SECRET_B58;
const ephemeral = !secret;
const wallet = secret ? Keypair.fromSecretKey(bs58.decode(secret)) : Keypair.generate();
if (ephemeral) console.warn("[signer] no WALLET_SECRET_B58: paper mode only");

export const owner = wallet.publicKey;
export const publicKey = owner.toBase58();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function signAndSend(tx: VersionedTransaction): Promise<string> {
  if (ephemeral) throw new Error("live trade refused: set WALLET_SECRET_B58 to trade live");
  tx.sign([wallet]);
  const raw = tx.serialize();

  // the blockhash this tx was BUILT with; it decides when the tx expires
  const blockhash = tx.message.recentBlockhash;

  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`tx failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;

    // once the blockhash expires, the tx can never land; stop waiting
    const { value: alive } = await conn.isBlockhashValid(blockhash, { commitment: "processed" });
    if (!alive) throw new Error(`expired before landing: ${sig}`);

    // rebroadcast the same signed bytes; duplicates are dropped by the network
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await sleep(1_500);
  }
  throw new Error(`confirm timeout: ${sig}`);
}
