import { expect, test } from "@playwright/test";
import type { PlaybackEngine } from "@frontstage/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __multitrackReady: boolean;
    __seekFrame: number;
    __readPixel: (x: number, y: number) => Promise<[number, number, number, number]>;
  }
}

test("composites a green image layer over the video base", async ({ page }) => {
  await page.goto("/multitrack.html");
  await page.waitForFunction(() => window.__multitrackReady === true, { timeout: 30_000 });

  // The top IMAGE clip is solid green and covers the upper-left quadrant (0..50% × 0..50%)
  // at opacity 1. The bottom VIDEO clip covers the full canvas.
  // After seek: top-left pixel should be GREEN; bottom-right pixel should be video (not green).

  // top-left quadrant center: (W/4, H/4) = (80, 60) — under green image layer
  const [tlR, tlG, tlB, tlA] = await page.evaluate(() => window.__readPixel(80, 60));

  // bottom-right region: (W*3/4, H*3/4) = (240, 180) — video only, no green overlay
  const [brR, brG, brB, brA] = await page.evaluate(() => window.__readPixel(240, 180));

  // Top-left must be green: G is high, R and B are low
  expect(tlA).toBeGreaterThan(0);
  expect(tlG).toBeGreaterThan(200);
  expect(tlR).toBeLessThan(50);
  expect(tlB).toBeLessThan(50);

  // Bottom-right must NOT be green (it's video)
  expect(brA).toBeGreaterThan(0);
  // Either R or B should be meaningfully present, OR G should be < threshold for "green"
  // i.e. the bottom-right is distinguishably different from green
  const brIsGreen = (brG ?? 0) > 200 && (brR ?? 0) < 50 && (brB ?? 0) < 50;
  expect(brIsGreen).toBe(false);

  // currentFrame must match the seek target
  const frameAfterSeek = await page.evaluate(() => window.__engine!.currentFrame);
  const seekFrame = await page.evaluate(() => window.__seekFrame);
  expect(frameAfterSeek).toBe(seekFrame);
});

test("multi-track seek composites top layer over base (quadrant vs base-only differs)", async ({ page }) => {
  await page.goto("/multitrack.html");
  await page.waitForFunction(() => window.__multitrackReady === true, { timeout: 30_000 });

  // top-left: green image layer composited over video
  const topLeft = await page.evaluate(() => window.__readPixel(80, 60));
  // bottom-right: video base only
  const bottomRight = await page.evaluate(() => window.__readPixel(240, 180));

  // Regions must differ: green top-left vs non-green bottom-right
  expect(topLeft[3]).toBeGreaterThan(0);
  expect(bottomRight[3]).toBeGreaterThan(0);
  // At least one channel differs between the two regions
  const differ =
    Math.abs((topLeft[0] ?? 0) - (bottomRight[0] ?? 0)) > 20 ||
    Math.abs((topLeft[1] ?? 0) - (bottomRight[1] ?? 0)) > 20 ||
    Math.abs((topLeft[2] ?? 0) - (bottomRight[2] ?? 0)) > 20;
  expect(differ).toBe(true);

  const frameAfterSeek = await page.evaluate(() => window.__engine!.currentFrame);
  const seekFrame = await page.evaluate(() => window.__seekFrame);
  expect(frameAfterSeek).toBe(seekFrame);

  // seek to frame 0 cleanly
  await page.evaluate(() => window.__engine!.seek(0, "scrub"));
  const frame0 = await page.evaluate(() => window.__engine!.currentFrame);
  expect(frame0).toBe(0);

  // openFrameCount bounded — Fix 2 makes this real (coordinator video frames counted)
  const open = await page.evaluate(() => window.__engine!.openFrameCount());
  expect(open).toBeLessThanOrEqual(8);
});

test("multi-track overlapping seeks do not leak and end consistent", async ({ page }) => {
  await page.goto("/multitrack.html");
  await page.waitForFunction(() => window.__multitrackReady === true, { timeout: 30_000 });

  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    await Promise.all([e.seek(3, "scrub"), e.seek(12, "scrub")]);
    return { open: e.openFrameCount(), frame: e.currentFrame };
  });

  expect(r.open).toBeLessThanOrEqual(8);
  expect(r.frame).toBeGreaterThanOrEqual(0);
});

test("multi-track seek composites: top-left blended differs from base-only bottom-right", async ({ page }) => {
  await page.goto("/multitrack.html");
  await page.waitForFunction(() => window.__multitrackReady === true, { timeout: 30_000 });

  await page.evaluate(() => window.__engine!.seek(1, "exact"));

  // top-left: green image; bottom-right: video base
  const [tlR, tlG, tlB] = await page.evaluate(() => window.__readPixel(80, 60));
  const [brR, brG, brB] = await page.evaluate(() => window.__readPixel(240, 180));

  // top-left is green
  expect(tlG).toBeGreaterThan(200);
  expect(tlR).toBeLessThan(50);
  expect(tlB).toBeLessThan(50);

  // bottom-right is not green (video content)
  const brIsGreen = (brG ?? 0) > 200 && (brR ?? 0) < 50 && (brB ?? 0) < 50;
  expect(brIsGreen).toBe(false);

  const frame = await page.evaluate(() => window.__engine!.currentFrame);
  expect(frame).toBe(1);
});

test("multi-track playback composites green image layer mid-play", async ({ page }) => {
  await page.goto("/multitrack.html");
  await page.waitForFunction(() => window.__multitrackReady === true, { timeout: 30_000 });

  // Seek to frame 0, then play
  await page.evaluate(() => window.__engine!.seek(0, "exact"));
  await page.evaluate(() => window.__engine!.play());

  // Wait ~500ms for frames to advance
  await page.waitForTimeout(500);

  // Pause to capture a stable frame
  await page.evaluate(() => window.__engine!.pause());

  // currentFrame must have advanced by at least a few frames
  const frame = await page.evaluate(() => window.__engine!.currentFrame);
  expect(frame).toBeGreaterThan(1);

  // Top-left quadrant should still be green (image layer composited during playback)
  const [tlR, tlG, tlB, tlA] = await page.evaluate(() => window.__readPixel(80, 60));
  expect(tlA).toBeGreaterThan(0);
  expect(tlG).toBeGreaterThan(200);
  expect(tlR).toBeLessThan(50);
  expect(tlB).toBeLessThan(50);

  // openFrameCount bounded — no frame leak during playback
  const open = await page.evaluate(() => window.__engine!.openFrameCount());
  expect(open).toBeLessThanOrEqual(8);
});
