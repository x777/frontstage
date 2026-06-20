import { expect, test } from "@playwright/test";
import type { ReadPixelFn } from "@palmier/engine";

test("rasterizes white centered text onto a composited frame", async ({ page }) => {
  await page.goto("/text.html");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 15_000 });

  const px = (x: number, y: number) =>
    page.evaluate(
      ([x, y]) =>
        (window as unknown as { __readPixel: ReadPixelFn }).__readPixel(x as number, y as number),
      [x, y],
    );

  // white "HELLO" centered on a black base → a center-ish pixel is bright; a corner is black
  const center = await px(100, 100);
  const corner = await px(8, 8);
  const centerLuma = center[0] + center[1] + center[2];
  const cornerLuma = corner[0] + corner[1] + corner[2];
  expect(centerLuma).toBeGreaterThan(cornerLuma + 150); // glyphs present at center, not at corner
});
