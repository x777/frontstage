import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __decodeAt: (us: number) => Promise<{ width: number; height: number; timestamp: number; openAfterClose: number }>;
    __openFrames: () => number;
    __decoderReady: boolean;
  }
}

test("decodes a frame at a target time and does not leak frames", async ({ page }) => {
  await page.goto("/decoder.html");
  await page.waitForFunction(() => window.__decoderReady === true, { timeout: 15_000 });

  const f = await page.evaluate(() => window.__decodeAt!(500_000)); // 0.5s
  expect(f.width).toBe(320);
  expect(f.height).toBe(240);
  expect(f.timestamp).toBeLessThanOrEqual(500_000);

  // leak guard: decode at 10 distinct times, each must close all but the returned frame
  const maxOpen = await page.evaluate(async () => {
    let max = 0;
    for (let i = 0; i < 10; i++) {
      await window.__decodeAt!(i * 150_000);
      max = Math.max(max, window.__openFrames!());
    }
    return max;
  });
  expect(maxOpen).toBeLessThanOrEqual(2); // at most the in-flight returned frame(s)
});
