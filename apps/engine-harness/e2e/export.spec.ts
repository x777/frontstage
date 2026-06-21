import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __exportAndDemux: (() => Promise<{
      hasVideo: boolean;
      width: number | undefined;
      height: number | undefined;
      videoSampleCount: number | undefined;
      timelineWidth: number;
      timelineHeight: number;
      totalFrames: number;
    }>) | undefined;
    __status: string;
  }
}

test("exports a multi-track timeline to a valid MP4 (video track round-trips)", async ({ page }) => {
  await page.goto("/export.html");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 30_000 });
  const r = await page.evaluate(() => window.__exportAndDemux!(), { timeout: 120_000 });
  expect(r.hasVideo).toBe(true);
  expect(r.width).toBe(r.timelineWidth);
  expect(r.height).toBe(r.timelineHeight);
  expect(r.videoSampleCount).toBeGreaterThanOrEqual(r.totalFrames - 2);
});
