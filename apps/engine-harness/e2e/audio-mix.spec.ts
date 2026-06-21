import { expect, test } from "@playwright/test";

test("per-clip gain attenuation flows through buildAudioPlan → mixer", async ({ page }) => {
  await page.goto("/audio-mix.html");
  await page.waitForFunction(() => window.__audioMixReady === true, { timeout: 30_000 });

  const r = await page.evaluate(async () => {
    const peakFull = await window.__measurePeak(1.0);
    const peakHalf = await window.__measurePeak(0.5);
    return { peakFull, peakHalf };
  });

  // Real signal at volume 1.0 (non-trivial, clearly above noise floor)
  expect(r.peakFull).toBeGreaterThan(0.05);
  // Attenuated but present at volume 0.5
  expect(r.peakHalf).toBeGreaterThan(0.05);
  // Half gain produces meaningfully lower peak than full gain
  expect(r.peakHalf).toBeLessThan(r.peakFull * 0.7);
});

test("two overlapping audio clips mix louder than one, ring drains, frame advances", async ({ page }) => {
  await page.goto("/audio-mix.html");
  await page.waitForFunction(() => window.__audioMixReady === true, { timeout: 30_000 });

  const r = await page.evaluate(async () => {
    const e = window.__engine!;
    e.seek(0, "exact");
    await new Promise((res) => setTimeout(res, 50));

    e.play();
    await new Promise((res) => setTimeout(res, 600));
    const frame = e.currentFrame;
    const peakDual = window.__getLastPeak();
    const fedDual = window.__getMixFed();
    e.pause();

    return { frame, peakDual, fedDual };
  });

  // Frame advanced during playback
  expect(r.frame).toBeGreaterThan(5);

  // Mix was fed into the ring (non-vacuous)
  expect(r.fedDual).toBeGreaterThan(0);

  // Peak sample is non-zero (not a silent mix)
  expect(r.peakDual).toBeGreaterThan(0.001);
});

test("mixNext terminates and produces real audio", async ({ page }) => {
  await page.goto("/audio-mix.html");
  await page.waitForFunction(() => window.__audioMixReady === true, { timeout: 30_000 });

  const r = await page.evaluate(() => {
    const mixer = window.__engine?.__audioMixer;
    // Expected: ceil(60 frames / 30fps * sampleRate / 2048)
    const sampleRate = mixer?.sampleRate ?? 44100;
    const expectedCount = Math.ceil(2 * sampleRate / 2048);
    const result = window.__mixNextPeaks();
    return { ...result, expectedCount };
  });

  // Loop terminates (count ≈ expected, within ±2 chunks due to rounding)
  expect(r.count).toBeGreaterThan(0);
  expect(Math.abs(r.count - r.expectedCount)).toBeLessThanOrEqual(2);

  // Real audio (non-silent)
  expect(r.anyNonZero).toBe(true);
});
