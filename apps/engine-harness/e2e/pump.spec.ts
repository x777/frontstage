import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __pumpStep: (targetUs: number) => { ts: number; buffered: number; open: number } | undefined;
    __bufferedCount: () => number;
    __openFrames: () => number;
    __pumpReady: boolean;
  }
}

test("forward pump serves monotonic frames, bounded buffer, no leak", async ({ page }) => {
  await page.goto("/pump.html");
  await page.waitForFunction(() => window.__pumpReady === true, { timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const out: { ts: number; buffered: number }[] = [];
    let maxBuffered = 0, maxOpen = 0;
    for (let us = 0; us < 1_800_000; us += 33_333) { // ~0..1.8s at 30fps
      await new Promise((res) => setTimeout(res, 5)); // let decode output arrive
      const s = window.__pumpStep!(us);
      if (s) out.push({ ts: s.ts, buffered: s.buffered });
      maxBuffered = Math.max(maxBuffered, window.__bufferedCount!());
      maxOpen = Math.max(maxOpen, window.__openFrames!());
    }
    return { out, maxBuffered, maxOpen };
  });
  // timestamps are non-decreasing
  for (let i = 1; i < r.out.length; i++) expect(r.out[i]!.ts).toBeGreaterThanOrEqual(r.out[i - 1]!.ts);
  expect(r.out.length).toBeGreaterThan(10);
  expect(r.maxBuffered).toBeLessThanOrEqual(40); // ~0.5s at 30fps + slack
  expect(r.maxOpen).toBeLessThanOrEqual(40);
});
