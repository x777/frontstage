import { expect, test } from "@playwright/test";
import type { ReadPixelFn } from "@palmier/engine";

test("composite blends a 50% layer over a base in z-order", async ({ page }) => {
  await page.goto("/composite.html");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 15_000 });

  const px = (x: number, y: number) =>
    page.evaluate(
      ([x, y]) =>
        (window as unknown as { __readPixel: ReadPixelFn }).__readPixel(x as number, y as number),
      [x, y],
    );

  // base = full-frame red; top = blue, half size centered, opacity 0.5
  const base = await px(20, 20); // outside top layer → pure red
  expect(base[0]).toBeGreaterThan(200);
  expect(base[2]).toBeLessThan(60);

  const blend = await px(100, 100); // under top layer → blend(red, blue@0.5) ≈ (128,0,128)
  expect(blend[0]).toBeGreaterThan(90);
  expect(blend[0]).toBeLessThan(165);
  expect(blend[2]).toBeGreaterThan(90);
  expect(blend[2]).toBeLessThan(165);
});
