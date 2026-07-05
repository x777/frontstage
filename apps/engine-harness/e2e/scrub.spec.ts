import { expect, test } from "@playwright/test";
import type { PlaybackEngine } from "@frontstage/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __engineReady: boolean;
  }
}

test("loads a clip, scrubs, renders frames, and does not leak", async ({ page }) => {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__engineReady === true, { timeout: 20_000 });

  const dur = await page.evaluate(() => window.__engine!.durationFrames);
  expect(dur).toBeGreaterThan(0);

  // scrub across the clip; currentFrame tracks; openFrameCount stays bounded
  const maxOpen = await page.evaluate(async () => {
    let max = 0;
    for (let f = 0; f < window.__engine!.durationFrames; f += 5) {
      await window.__engine!.seek(f, "scrub");
      max = Math.max(max, window.__engine!.openFrameCount());
    }
    return max;
  });
  expect(maxOpen).toBeLessThanOrEqual(2);

  const frameAfter = await page.evaluate(() => window.__engine!.currentFrame);
  expect(frameAfter).toBeGreaterThan(0);
});

test("overlapping seeks do not leak and end consistent", async ({ page }) => {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__engineReady === true, { timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    await Promise.all([e.seek(3, "scrub"), e.seek(12, "scrub")]); // overlap
    return { open: e.openFrameCount(), frame: e.currentFrame };
  });
  expect(r.open).toBeLessThanOrEqual(2);
  expect(r.frame).toBeGreaterThanOrEqual(0);
});
