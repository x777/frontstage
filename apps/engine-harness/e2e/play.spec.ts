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

test("scrubbing during playback stops the loop and does not leak", async ({ page }) => {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__engineReady === true, { timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    e.seek(0, "exact"); await new Promise((res) => setTimeout(res, 50));
    e.play();
    await new Promise((res) => setTimeout(res, 300));   // playing
    await e.seek(20, "scrub");                          // scrub mid-play
    await new Promise((res) => setTimeout(res, 200));   // let any stale rAF settle
    return { playing: e.isPlaying, frame: e.currentFrame, open: e.openFrameCount() };
  });
  expect(r.playing).toBe(false);          // play loop stopped by the scrub
  expect(r.frame).toBe(20);              // scrub target honored
  expect(r.open).toBeLessThanOrEqual(2); // pump buffer drained, no leak
});
