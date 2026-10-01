// test/replay.ts
import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { store } from "../src/core/store";
import { bot } from "../src/bot";

const file = process.argv[2] ?? "fixtures/sample.jsonl";
process.env.SAFETY_STUB = "1";            // no RPC calls during replay
if (!existsSync(file)) {
  console.error(`${file} not found. Run \`npm run fixture\` for the synthetic sample, or \`npm run record\` for real data.`);
  process.exit(1);
}
const events = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

bot.paper = true;
let errors = 0;
process.on("unhandledRejection", () => errors++);

for (const e of events) {
  store.clock = e.ts;                      // the store uses this instead of Date.now()
  if (e.kind === "token") store.upsert(e.data);
  if (e.kind === "patch") store.patch(e.mint, e.data);
  await bot.step();                        // score, safety stub, entries, exits
}

// close whatever is still open at the last price, so stats count every trade
await bot.closeAll("END");
await bot.step();

console.table(bot.stats());
console.log("unhandled rejections:", errors);
process.exit(errors ? 1 : 0);
