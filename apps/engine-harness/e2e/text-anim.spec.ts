import { expect, test } from "@playwright/test";

type WordPeakFn = (index: 0 | 1 | 2) => Promise<[number, number, number]>;

const wordPeak = (page: import("@playwright/test").Page, index: 0 | 1 | 2) =>
  page.evaluate(
    (index) => (window as unknown as { __wordPeak: WordPeakFn }).__wordPeak(index),
    index,
  );

test("wordReveal: before word 0's entrance frame shows no words", async ({ page }) => {
  await page.goto("/text-anim.html?case=wordReveal0");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  for (const band of [0, 1, 2] as const) {
    const [r, g, b] = await wordPeak(page, band);
    expect(r + g + b).toBeLessThan(120); // black background only, no glyphs
  }
});

test("wordReveal: mid-word-0 shows only word 0 — rest laid out but invisible, no reflow", async ({ page }) => {
  await page.goto("/text-anim.html?case=wordReveal1");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const [r0, g0, b0] = await wordPeak(page, 0);
  expect(r0 + g0 + b0).toBeGreaterThan(400); // word 0 (AAA) visible, near-white
  for (const band of [1, 2] as const) {
    const [r, g, b] = await wordPeak(page, band);
    expect(r + g + b).toBeLessThan(120); // words 1/2 not yet revealed
  }
});

test("wordReveal: past the last word's entrance frame shows all three words", async ({ page }) => {
  await page.goto("/text-anim.html?case=wordRevealAll");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  for (const band of [0, 1, 2] as const) {
    const [r, g, b] = await wordPeak(page, band);
    expect(r + g + b).toBeGreaterThan(400);
  }
});

test("highlightPop: the active word (band 1) is tinted highlightColor; the others stay the base color", async ({ page }) => {
  await page.goto("/text-anim.html?case=highlightPop");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });

  // Word 0 (AAA) and word 2 (CCC) are unhighlighted -> stay near-white (base color).
  const [r0, g0, b0] = await wordPeak(page, 0);
  expect(r0).toBeGreaterThan(200);
  expect(b0).toBeGreaterThan(200);
  const [r2, g2, b2] = await wordPeak(page, 2);
  expect(r2).toBeGreaterThan(200);
  expect(b2).toBeGreaterThan(200);

  // Word 1 (BBB) is the active word at frame 15 -> tinted toward highlightColor (0,1,0): green
  // channel dominant, red/blue suppressed.
  const [r1, g1, b1] = await wordPeak(page, 1);
  expect(g1).toBeGreaterThan(200);
  expect(r1).toBeLessThan(g1 - 50);
  expect(b1).toBeLessThan(g1 - 50);
});
