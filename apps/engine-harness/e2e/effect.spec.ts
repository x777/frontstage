import { test, expect } from "@playwright/test";
import type { ReadPixelFn } from "@palmier/engine";

const px = (page: import("@playwright/test").Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]: [number, number]) =>
      (window as unknown as { __readPixel: ReadPixelFn }).__readPixel(x, y),
    [x, y] as [number, number],
  );

test("saturation amount=0 desaturates a red layer to grey", async ({ page }) => {
  await page.goto("/effect.html?case=fx");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const p = await px(page, 100, 100);
  // red(255,0,0) -> luma grey ~ 0.2126*255 ≈ 54; R≈G≈B
  expect(Math.abs(p[0] - p[1])).toBeLessThan(4);
  expect(Math.abs(p[1] - p[2])).toBeLessThan(4);
  expect(p[0]).toBeGreaterThan(40);
  expect(p[0]).toBeLessThan(70);
});

test("a plain layer (no effects) is unchanged red", async ({ page }) => {
  await page.goto("/effect.html?case=plain");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const p = await px(page, 100, 100);
  expect(p[0]).toBeGreaterThan(220); // R
  expect(p[1]).toBeLessThan(40);     // G
  expect(p[2]).toBeLessThan(40);     // B
});
