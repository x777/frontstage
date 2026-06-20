import { expect, test } from "@playwright/test";

type MaxLumaFn = (x0: number, y0: number, x1: number, y1: number) => Promise<number>;

test("rasterizes white centered text onto a composited frame", async ({ page }) => {
  await page.goto("/text.html");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 15_000 });

  const maxLuma = (x0: number, y0: number, x1: number, y1: number) =>
    page.evaluate(
      ([x0, y0, x1, y1]) =>
        (window as unknown as { __maxLuma: MaxLumaFn }).__maxLuma(
          x0 as number, y0 as number, x1 as number, y1 as number,
        ),
      [x0, y0, x1, y1],
    );

  // white "HELLO" centered on a black base → max luma in the center band is bright,
  // max luma in a corner is dark (no glyphs)
  const centerMax = await maxLuma(60, 85, 140, 115);
  const cornerMax = await maxLuma(0, 0, 30, 30);
  expect(centerMax).toBeGreaterThan(400); // near-white text present somewhere in the center band
  expect(cornerMax).toBeLessThan(120);    // black base, no glyphs in corner
});
