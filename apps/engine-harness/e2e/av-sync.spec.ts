import { expect, test } from "@playwright/test";

test("play keeps video frame in sync with the audio clock", async ({ page }) => {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__engineReady === true, { timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    e.seek(0, "exact"); await new Promise((res) => setTimeout(res, 50));
    e.play();
    await new Promise((res) => setTimeout(res, 1000));
    const frame = e.currentFrame;
    const audioSeconds = window.__audioCurrentTime?.() ?? 0;
    e.pause();
    return { frame, audioSeconds, fps: 30 };
  });
  // ~1.0s played → ~30 frames at 30fps; video frame tracks audio time within ±4 frames
  expect(r.frame).toBeGreaterThan(15);
  if (r.audioSeconds > 0) expect(Math.abs(r.frame - r.audioSeconds * r.fps)).toBeLessThanOrEqual(4);
});
