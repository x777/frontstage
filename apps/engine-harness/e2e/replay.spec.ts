import { expect, test } from "@playwright/test";

test("play to end drains the audio ring, and replay/seek-then-play work", async ({ page }) => {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__engineReady === true, { timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    // 1) play to (near) end → ring should drain low
    e.seek(0, "exact"); await wait(50); e.play(); await wait(2200);
    const endFrame = e.currentFrame, openAtEnd = e.openFrameCount();
    // 2) seek to a non-zero frame then play → advances from there, no crash
    await e.seek(20, "scrub"); await wait(50); e.play(); await wait(400);
    const replayFrame = e.currentFrame; e.pause();
    return { endFrame, openAtEnd, replayFrame };
  });
  expect(r.endFrame).toBeGreaterThan(40);          // played most of the ~2s/60-frame clip
  expect(r.openAtEnd).toBeLessThanOrEqual(40);     // no leak at end
  expect(r.replayFrame).toBeGreaterThan(20);       // seek(20)+play advanced past 20 (no stale-state hang)
});
