import { expect, test } from "@playwright/test";
import type { ReadPixelFn } from "@palmier/engine";

test("FrameRenderer letterboxes a 16:9 red frame into a 1:1 canvas", async ({ page }) => {
  await page.goto("/renderer.html");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 15_000 });

  // Center pixel should be red (inside the 320×180 content area)
  const center = await page.evaluate(async () => {
    const fn = (window as unknown as { __readPixel: ReadPixelFn }).__readPixel;
    return fn(100, 100);
  });
  expect(center[0]).toBeGreaterThan(200); // R
  expect(center[1]).toBeLessThan(60);     // G
  expect(center[2]).toBeLessThan(60);     // B

  // Top bar pixel should be black (letterbox, outside the content area)
  // Bar height ≈ 44px; pixel (100, 5) is in the top bar
  const bar = await page.evaluate(async () => {
    const fn = (window as unknown as { __readPixel: ReadPixelFn }).__readPixel;
    return fn(100, 5);
  });
  expect(bar[0]).toBeLessThan(60); // R
  expect(bar[1]).toBeLessThan(60); // G
  expect(bar[2]).toBeLessThan(60); // B
});
