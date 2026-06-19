import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __audioDecode: () => { totalFrames: number; sampleRate: number; channels: number };
    __audioReady: boolean;
  }
}

test("decodes the AAC track to PCM", async ({ page }) => {
  await page.goto("/audio-decode.html");
  await page.waitForFunction(() => window.__audioReady === true, { timeout: 20_000 });
  const r = await page.evaluate(() => window.__audioDecode!());
  expect(r.sampleRate).toBeGreaterThan(0);
  expect(r.channels).toBeGreaterThanOrEqual(1);
  expect(r.totalFrames).toBeGreaterThan(r.sampleRate); // > ~1s of audio for the ~2s clip
});
