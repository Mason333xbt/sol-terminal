// src/core/limiter.ts
export function limiter(max: number, windowMs: number) {
  const stamps: number[] = [];
  return async function gate(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
      if (stamps.length < max) {
        stamps.push(now);
        return;
      }
      const wait = windowMs - (now - stamps[0]) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
    }
  };
}
