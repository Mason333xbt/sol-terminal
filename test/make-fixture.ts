// test/make-fixture.ts
// Writes fixtures/sample.jsonl: a SYNTHETIC feed for smoke-testing the replay harness.
// It is not market data. Record real data with RECORD=1 npm start before tuning anything.
import { mkdirSync, writeFileSync } from "fs";

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

type Fate = "runner" | "dud" | "rug";
const lines: string[] = [];
const t0 = Date.parse("2026-01-01T00:00:00Z");
const TOKENS = 60;
const STEP_MS = 3_000;
const LIFE_STEPS = 400; // 20 minutes per token

for (let i = 0; i < TOKENS; i++) {
  const mint = `SYNTH${String(i).padStart(4, "0")}pump`;
  const born = t0 + i * 30_000;
  const r = rnd();
  const fate: Fate = r < 0.2 ? "runner" : r < 0.75 ? "dud" : "rug";
  let price = 2.8e-8 * (0.8 + rnd() * 0.4);

  lines.push(JSON.stringify({
    ts: born,
    kind: "token",
    data: {
      mint, symbol: `SYN${i}`, name: `Synthetic ${i}`, stage: "curve", decimals: 6,
      devBuySol: +(rnd() * 4).toFixed(2), priceSol: price, createdAt: born, updatedAt: born,
    },
  }));

  const rugAt = 40 + Math.floor(rnd() * 200);
  for (let s = 1; s < LIFE_STEPS; s++) {
    const drift = fate === "runner" ? 0.004 : fate === "dud" ? -0.002 : s < rugAt ? 0.003 : -0.35;
    price = Math.max(1e-12, price * Math.exp(drift + 0.03 * gauss()));
    const hot = fate === "runner" || (fate === "rug" && s < rugAt);
    const buys = Math.max(0, Math.round((hot ? 40 : 15) + 10 * gauss()));
    const sells = Math.max(0, Math.round((hot ? 18 : 20) + 8 * gauss()));
    lines.push(JSON.stringify({
      ts: born + s * STEP_MS,
      kind: "patch",
      mint,
      data: { priceSol: price, buysM5: buys, sellsM5: sells, volM5: (buys + sells) * 120, liquidityUsd: 15_000 },
    }));
  }
}

// replay must see events in time order
lines.sort((a, b) => JSON.parse(a).ts - JSON.parse(b).ts);
mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/sample.jsonl", lines.join("\n") + "\n");
console.log(`fixtures/sample.jsonl: ${lines.length} synthetic events, ${TOKENS} tokens`);
