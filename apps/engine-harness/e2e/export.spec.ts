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
      hasAudio: boolean;
      audioSampleRate: number | undefined;
      videoDurationUs: number | undefined;
      audioDurationUs: number | undefined;
    }>) | undefined;
    __status: string;
  }
}

test("exports a multi-track timeline to a valid MP4 (video + audio tracks round-trip)", async ({ page }) => {
  await page.goto("/export.html");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 30_000 });
  const r = await page.evaluate(() => window.__exportAndDemux!(), { timeout: 120_000 });

  // Video track assertions
  expect(r.hasVideo).toBe(true);
  expect(r.width).toBe(r.timelineWidth);
  expect(r.height).toBe(r.timelineHeight);
  expect(r.videoSampleCount).toBeGreaterThanOrEqual(r.totalFrames - 2);

  // Audio track assertions
  expect(r.hasAudio).toBe(true);
  expect(r.audioSampleRate).toBe(44100);

  // Audio duration should be within 0.2s of video duration
  expect(r.videoDurationUs).toBeDefined();
  expect(r.audioDurationUs).toBeDefined();
  const diffUs = Math.abs(r.audioDurationUs! - r.videoDurationUs!);
  expect(diffUs).toBeLessThanOrEqual(200_000);
});
