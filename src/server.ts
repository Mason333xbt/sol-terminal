// src/server.ts
import "dotenv/config";                  // must load before any module reads process.env
import { WebSocketServer } from "ws";
import { appendFileSync, mkdirSync } from "fs";
import { store } from "./core/store";
import { startPumpPortal } from "./feeds/pumpportal";
import "./feeds/dexscreener";
import { bot } from "./bot";

const PORT = Number(process.env.PORT ?? 8787);
const pumpportal = startPumpPortal();

// open positions need live curve prices: subscribe their trade stream
store.on("watch", (mint: string) => pumpportal.watch([mint]));

// RECORD=1 writes every store event to fixtures/ for replay later
if (process.env.RECORD === "1") {
  mkdirSync("fixtures", { recursive: true });
  const file = `fixtures/${new Date().toISOString().slice(0, 10)}.jsonl`;
  store.on("record", (e: unknown) => appendFileSync(file, JSON.stringify(e) + "\n"));
  console.log(`[record] writing ${file}`);
}

// the bot loop: exits first, then entries
setInterval(() => {
  bot.step().catch((e: Error) => bot.log.push("ERR " + e.message));
}, 500);

// keep memory flat on long sessions
setInterval(() => store.prune(new Set(bot.positions().map((p) => p.mint))), 60_000);

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
console.log(`[ui] ws://127.0.0.1:${PORT}  open ui/terminal.html  mode=${bot.paper ? "PAPER" : "LIVE"}`);

// push a compact snapshot 4 times a second
setInterval(() => {
  const snap = JSON.stringify({
    type: "snap",
    feed: store.latest(40),
    watch: store.ranked(15),
    positions: bot.positions(),
    pnl: bot.pnl(),
    log: bot.log.slice(-30),
    paper: bot.paper,
  });
  wss.clients.forEach((c) => c.readyState === 1 && c.send(snap));
}, 250);

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const cmd = JSON.parse(raw.toString());
      if (cmd.type === "buy" && typeof cmd.mint === "string") bot.manualBuy(cmd.mint).catch((e: Error) => bot.log.push("ERR " + e.message));
      if (cmd.type === "panic") bot.closeAll("PANIC").catch((e: Error) => bot.log.push("ERR " + e.message));
    } catch {
      /* ignore malformed commands */
    }
  });
});
