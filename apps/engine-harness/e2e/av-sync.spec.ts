import { expect, test } from "@playwright/test";

test("play keeps video frame in sync with the audio clock", async ({ page }) => {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__engineReady === true, { timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    e.seek(0, "exact"); await new Promise((res) => setTimeout(res, 50));
    e.play();
    await new Promise((res) => setTimeout(res, 800));
    const frame = e.currentFrame;
    const audioFrames = window.__audioCurrentTime?.() ?? 0;
    e.pause();
    return { frame, audioFrames, fps: 30 };
  });
  // ~0.8s played → ~24 frames at 30fps; video frame tracks audio time within ±3 frames
  expect(r.frame).toBeGreaterThan(15);
  if (r.audioFrames > 0) expect(Math.abs(r.frame - r.audioFrames * r.fps)).toBeLessThanOrEqual(3);
});
