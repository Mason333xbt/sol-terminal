// src/core/store.ts
import { EventEmitter } from "events";
import type { Token } from "./token";

class Store extends EventEmitter {
  private tokens = new Map<string, Token>();
  clock: number | null = null;              // replay sets this, live leaves it null

  now() {
    return this.clock ?? Date.now();
  }

  upsert(t: Token) {
    const prev = this.tokens.get(t.mint);
    this.tokens.set(t.mint, { ...prev, ...t, updatedAt: this.now() });
    this.emit("record", { ts: this.now(), kind: "token", data: t });
    this.emit("token", t.mint);
  }

  patch(mint: string, data: Partial<Token>) {
    const cur = this.tokens.get(mint);
    if (!cur) return;                        // ignore tokens we never saw launch
    Object.assign(cur, data, { updatedAt: this.now() });
    this.emit("record", { ts: this.now(), kind: "patch", mint, data });
    this.emit("token", mint);
  }

  get(mint: string) {
    return this.tokens.get(mint);
  }

  activeMints(maxAgeMin = 60) {
    const cutoff = this.now() - maxAgeMin * 60_000;
    return [...this.tokens.values()].filter((t) => t.createdAt > cutoff).map((t) => t.mint);
  }

  latest(n: number) {
    return [...this.tokens.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, n);
  }

  ranked(n: number) {
    return [...this.tokens.values()]
      .filter((t) => t.score != null && t.safety?.ok !== false)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, n);
  }

  // drop old tokens so memory stays flat over a long session
  prune(keep: Set<string>, maxAgeMin = 120) {
    const cutoff = this.now() - maxAgeMin * 60_000;
    for (const [mint, t] of this.tokens) if (t.createdAt < cutoff && !keep.has(mint)) this.tokens.delete(mint);
  }
}

export const store = new Store();
