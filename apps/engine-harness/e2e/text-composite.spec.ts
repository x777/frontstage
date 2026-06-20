import { expect, test } from "@playwright/test";
import type { PlaybackEngine } from "@palmier/engine";

type MaxLumaFn = (x0: number, y0: number, x1: number, y1: number) => Promise<number>;

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __textCompositeReady: boolean;
    __maxLuma: MaxLumaFn;
  }
}

const maxLuma = (page: import("@playwright/test").Page, x0: number, y0: number, x1: number, y1: number) =>
  page.evaluate(
    ([x0, y0, x1, y1]) =>
      (window as unknown as { __maxLuma: MaxLumaFn }).__maxLuma(
        x0 as number, y0 as number, x1 as number, y1 as number,
      ),
    [x0, y0, x1, y1],
  );

test("text composites over video at correct z-order (seek)", async ({ page }) => {
  await page.goto("/text-composite.html");
  await page.waitForFunction(() => window.__textCompositeReady === true, { timeout: 30_000 });

  // White "HELLO" text is centered on the canvas (320×240), at z=1 over video at z=0.
  // Center band (x:80..240, y:90..150) should contain the bright white text.
  // A corner (x:0..40, y:0..40) has no text — just video, which is distinctly less bright.
  const centerMax = await maxLuma(page, 80, 90, 240, 150);
  const cornerMax = await maxLuma(page, 0, 0, 40, 40);

  expect(centerMax).toBeGreaterThan(400); // near-white text present in center band
  expect(cornerMax).toBeLessThan(centerMax - 100); // corner distinctly less bright than text
});

test("text composites over video at correct z-order (playback)", async ({ page }) => {
  await page.goto("/text-composite.html");
  await page.waitForFunction(() => window.__textCompositeReady === true, { timeout: 30_000 });

  await page.evaluate(() => window.__engine!.seek(0, "exact"));
  await page.evaluate(() => window.__engine!.play());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__engine!.pause());

  const frame = await page.evaluate(() => window.__engine!.currentFrame);
  expect(frame).toBeGreaterThan(0);

  // Text should still be bright in center band during/after playback
  const centerMax = await maxLuma(page, 80, 90, 240, 150);
  const cornerMax = await maxLuma(page, 0, 0, 40, 40);

  expect(centerMax).toBeGreaterThan(400);
  expect(cornerMax).toBeLessThan(centerMax - 100);
});
