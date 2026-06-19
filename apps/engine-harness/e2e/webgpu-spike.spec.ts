import { expect, test } from "@playwright/test";

test("headless WebGPU clears the canvas to red", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 15_000 });

  // Pixel is read back via GPU buffer in spike.ts and stored in canvas dataset.pixel (RGBA csv).
  const pixel = await page.evaluate(() => {
    const c = document.getElementById("c") as HTMLCanvasElement;
    return (c.dataset["pixel"] ?? "0,0,0,0").split(",").map(Number);
  });

  expect(pixel[0]).toBeGreaterThan(200); // red
  expect(pixel[1]).toBeLessThan(60);
  expect(pixel[2]).toBeLessThan(60);
});
