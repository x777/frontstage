import { expect, test } from "@playwright/test";

// H1 regression (M13A review, .superpowers/sdd/m13a-broad-review.md): the compositor's track
// z-order must match the Swift/model convention "track index 0 = topmost" (documented in
// xmeml-exporter.ts:53 and track-commands.test.ts, enforced in Swift by
// CompositionBuilder.swift's reverse track walk). SourceCoordinator.layersForScrub/layersForPlayback
// sort by zIndex descending so track 0 draws last (on top). These two specs pin that behavior at
// the pixel level so a regression here (e.g. sort direction flipping back to ascending) fails loudly
// instead of silently breaking PIP layouts and captions.

declare global {
  interface Window {
    __zOrderMatteReady: boolean;
    __readPixel: (x: number, y: number) => Promise<[number, number, number, number]>;
  }
}

test("two overlapping opaque clips: track 0 (red) renders on top of track 1 (blue)", async ({ page }) => {
  await page.goto("/z-order-matte.html");
  await page.waitForFunction(() => window.__zOrderMatteReady === true, { timeout: 30_000 });

  const [r, g, b, a] = await page.evaluate(() => window.__readPixel(100, 100));

  // Track 0's opaque red matte must fully occlude track 1's opaque blue matte.
  expect(a).toBeGreaterThan(0);
  expect(r).toBeGreaterThan(200);
  expect(g).toBeLessThan(50);
  expect(b).toBeLessThan(50);
});

test("caption scenario: a text clip on track 0 renders on top of video on track 1", async ({ page }) => {
  // Reuses the text-composite fixture, which places its text clip on track 0 and its video clip
  // on track 1 (the same shape placeCaptionsCommand relies on: caption track inserted at index 0
  // so it sits above the video it captions). If track z-order ever inverts, the video (opaque,
  // full-frame) would render on top and the text would be invisible.
  await page.goto("/text-composite.html");
  await page.waitForFunction(() => window.__textCompositeReady === true, { timeout: 30_000 });

  type MaxLumaFn = (x0: number, y0: number, x1: number, y1: number) => Promise<number>;
  const maxLuma = (x0: number, y0: number, x1: number, y1: number) =>
    page.evaluate(
      ([x0, y0, x1, y1]) =>
        (window as unknown as { __maxLuma: MaxLumaFn }).__maxLuma(
          x0 as number, y0 as number, x1 as number, y1 as number,
        ),
      [x0, y0, x1, y1],
    );

  // Center band holds the white "HELLO" text; a corner has only the video underneath.
  const centerMax = await maxLuma(80, 90, 240, 150);
  const cornerMax = await maxLuma(0, 0, 40, 40);

  expect(centerMax).toBeGreaterThan(400); // text is visible, i.e. drawn on top
  expect(cornerMax).toBeLessThan(centerMax - 100);
});
