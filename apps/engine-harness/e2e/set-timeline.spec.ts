import { expect, test } from "@playwright/test";
import type { PlaybackEngine } from "@frontstage/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __setTimelineReady: boolean;
    __layerCountAfterSetTimeline: () => Promise<number>;
    __layerCountAfterRevert: () => Promise<number>;
    __openFrameCountAfterRevert: () => number;
  }
}

test("setTimeline to 2-clip timeline produces 2 composited layers", async ({ page }) => {
  await page.goto("/set-timeline.html");
  await page.waitForFunction(() => window.__setTimelineReady === true, { timeout: 30_000 });

  const count = await page.evaluate(() => window.__layerCountAfterSetTimeline());
  expect(count).toBe(2);
});

test("setTimeline back to 1-clip produces 1 layer and no source leak", async ({ page }) => {
  await page.goto("/set-timeline.html");
  await page.waitForFunction(() => window.__setTimelineReady === true, { timeout: 30_000 });

  // First go to 2 clips
  await page.evaluate(() => window.__layerCountAfterSetTimeline());

  // Then revert to 1 clip
  const count = await page.evaluate(() => window.__layerCountAfterRevert());
  expect(count).toBe(1);

  // Removed clip's source should be disposed — open frame count stays bounded
  const open = await page.evaluate(() => window.__openFrameCountAfterRevert());
  expect(open).toBeLessThanOrEqual(8);
});
