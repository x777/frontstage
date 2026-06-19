import { expect, test } from "@playwright/test";

test("play advances frames then pause holds", async ({ page }) => {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__engineReady === true, { timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    e.seek(0, "exact"); await new Promise((res) => setTimeout(res, 50));
    e.play();
    await new Promise((res) => setTimeout(res, 600)); // ~0.6s of playback
    const playing = e.currentFrame;
    e.pause();
    await new Promise((res) => setTimeout(res, 200));
    const afterPause = e.currentFrame;
    return { playing, afterPause, open: e.openFrameCount() };
  });
  expect(r.playing).toBeGreaterThan(5);       // advanced during play
  expect(Math.abs(r.afterPause - r.playing)).toBeLessThanOrEqual(1); // frozen after pause
  expect(r.open).toBeLessThanOrEqual(40);      // no runaway leak
});
