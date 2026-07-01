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

// Parity tests: GPU pixel must match CPU-computed expected within ±3 (8-bit quantisation).
const PARITY_CASES = [
  "exposure",
  "contrast",
  "highlightsShadows",
  "blacksWhites",
  "temperature",
  "vibrance",
  "wheels",
  "wheels2",
] as const;

for (const c of PARITY_CASES) {
  test(`color.${c} GPU matches CPU within ±3`, async ({ page }) => {
    await page.goto(`/effect.html?case=${c}`);
    await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
    const expected = await page.evaluate(
      () => (window as unknown as { __expected: [number, number, number] }).__expected,
    );
    const p = await px(page, 100, 100);
    for (let ch = 0; ch < 3; ch++) {
      const exp8 = Math.round(expected[ch]! * 255);
      expect(Math.abs(p[ch]! - exp8)).toBeLessThanOrEqual(3);
    }
  });
}

// LUT-based effects: ±4 tolerance (uint8 LUT quantisation).
const LUT_CASES = ["curves", "hueCurves"] as const;

for (const c of LUT_CASES) {
  test(`color.${c} GPU matches CPU within ±4 (LUT quantisation)`, async ({ page }) => {
    await page.goto(`/effect.html?case=${c}`);
    await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
    const expected = await page.evaluate(
      () => (window as unknown as { __expected: [number, number, number] }).__expected,
    );
    const p = await px(page, 100, 100);
    for (let ch = 0; ch < 3; ch++) {
      const exp8 = Math.round(expected[ch]! * 255);
      expect(Math.abs(p[ch]! - exp8)).toBeLessThanOrEqual(4);
    }
  });
}

// color.lut 3D-texture tests: ±4 tolerance (float32 precision through rgba8unorm readback).
test("color.lut identity 2³ cube round-trips input unchanged", async ({ page }) => {
  await page.goto("/effect.html?case=lut");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const expected = await page.evaluate(
    () => (window as unknown as { __expected: [number, number, number] }).__expected,
  );
  const p = await px(page, 100, 100);
  for (let ch = 0; ch < 3; ch++) {
    const exp8 = Math.round(expected[ch]! * 255);
    expect(Math.abs(p[ch]! - exp8)).toBeLessThanOrEqual(4);
  }
});

test("color.lut non-identity 2³ invert cube matches CPU sampleLUT within ±4", async ({ page }) => {
  await page.goto("/effect.html?case=lut2");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const expected = await page.evaluate(
    () => (window as unknown as { __expected: [number, number, number] }).__expected,
  );
  const p = await px(page, 100, 100);
  for (let ch = 0; ch < 3; ch++) {
    const exp8 = Math.round(expected[ch]! * 255);
    expect(Math.abs(p[ch]! - exp8)).toBeLessThanOrEqual(4);
  }
});

// Blend mode parity tests: two-layer composite (bg grey 0.5, top 0.6/0.4/0.8) vs CPU blendPixel.
const BLEND_CASES = ["blend-multiply", "blend-screen", "blend-overlay", "blend-difference", "blend-colorBurn"] as const;

for (const c of BLEND_CASES) {
  test(`${c} GPU matches CPU blendPixel within ±3`, async ({ page }) => {
    await page.goto(`/effect.html?case=${c}`);
    await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
    const expected = await page.evaluate(
      () => (window as unknown as { __expected: [number, number, number] }).__expected,
    );
    const p = await px(page, 100, 100);
    for (let ch = 0; ch < 3; ch++) {
      const exp8 = Math.round(expected[ch]! * 255);
      expect(Math.abs(p[ch]! - exp8)).toBeLessThanOrEqual(3);
    }
  });
}

// HSL blend mode parity: bg rgb(0.2,0.5,0.7), top rgb(0.6,0.4,0.8), ±4 tolerance (HSL clip nonlinearity).
const HSL_BLEND_CASES = ["blend-hue", "blend-saturation", "blend-color", "blend-luminosity"] as const;

for (const c of HSL_BLEND_CASES) {
  test(`${c} GPU matches CPU blendPixel within ±4`, async ({ page }) => {
    await page.goto(`/effect.html?case=${c}`);
    await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
    const expected = await page.evaluate(
      () => (window as unknown as { __expected: [number, number, number] }).__expected,
    );
    const p = await px(page, 100, 100);
    for (let ch = 0; ch < 3; ch++) {
      const exp8 = Math.round(expected[ch]! * 255);
      expect(Math.abs(p[ch]! - exp8)).toBeLessThanOrEqual(4);
    }
  });
}

// key.chroma: GPU parity vs applyChromaKey (alpha + pre-multiplied rgb within ±4).
test("key.chroma GPU matches applyChromaKey within ±4 (alpha + PMA rgb)", async ({ page }) => {
  await page.goto("/effect.html?case=chroma");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const expected = await page.evaluate(
    () => (window as unknown as { __expectedRGBA: [number, number, number, number] }).__expectedRGBA,
  );
  const p = await px(page, 100, 100);
  // alpha parity
  expect(Math.abs(p[3]! - Math.round(expected[3]! * 255))).toBeLessThanOrEqual(4);
  // rgb parity against pre-multiplied expected (compositor alpha-blends into transparent bg)
  for (let ch = 0; ch < 3; ch++) {
    const expPma = Math.round(expected[ch]! * expected[3]! * 255);
    expect(Math.abs(p[ch]! - expPma)).toBeLessThanOrEqual(4);
  }
});

// key.chroma-partial: exercises spill+partial-alpha path — GPU must match CPU on a ~50% key.
test("key.chroma-partial GPU matches applyChromaKey within ±4 (spill + partial alpha)", async ({ page }) => {
  await page.goto("/effect.html?case=chroma-partial");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const expected = await page.evaluate(
    () => (window as unknown as { __expectedRGBA: [number, number, number, number] }).__expectedRGBA,
  );
  const p = await px(page, 100, 100);
  // alpha parity
  expect(Math.abs(p[3]! - Math.round(expected[3]! * 255))).toBeLessThanOrEqual(4);
  // rgb parity against pre-multiplied expected (compositor alpha-blends into transparent bg)
  for (let ch = 0; ch < 3; ch++) {
    const expPma = Math.round(expected[ch]! * expected[3]! * 255);
    expect(Math.abs(p[ch]! - expPma)).toBeLessThanOrEqual(4);
  }
});

// stylize.vignette: corner must be darker than center (amount=-0.8 darkens corners).
test("stylize.vignette darkens corners relative to center", async ({ page }) => {
  await page.goto("/effect.html?case=vignette");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const corner = await px(page, 5, 5);
  const center = await px(page, 100, 100);
  expect(corner[0]!).toBeLessThan(center[0]!);
});

// stylize.grain: amount=0.5 adds noise (two distant pixels must differ); amount=0 is passthrough.
test("stylize.grain adds noise when amount>0", async ({ page }) => {
  await page.goto("/effect.html?case=grain");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const a = await px(page, 5, 5);
  const b = await px(page, 50, 50);
  const differ = a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2];
  expect(differ).toBe(true);
});

test("stylize.grain amount=0 is a passthrough (output = input grey)", async ({ page }) => {
  await page.goto("/effect.html?case=grain-zero");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const p = await px(page, 100, 100);
  // Input was rgb(128,128,128); with amount=0 the effect is a no-op.
  expect(Math.abs(p[0]! - 128)).toBeLessThanOrEqual(2);
  expect(Math.abs(p[1]! - 128)).toBeLessThanOrEqual(2);
  expect(Math.abs(p[2]! - 128)).toBeLessThanOrEqual(2);
});

// blur.gaussian: hard vertical step edge (left black, right white, edge at x=100) blurred with radius 12.
// A sharp edge pixel at (100,100) would be 0 or 255; a blurred edge is mid-grey.
test("blur.gaussian blurs a hard edge to mid-grey", async ({ page }) => {
  await page.goto("/effect.html?case=gaussian");
  await expect(page.locator("#status")).toHaveText("ok", { timeout: 20_000 });
  const p = await px(page, 100, 100);
  expect(p[0]!).toBeGreaterThan(80);
  expect(p[0]!).toBeLessThan(175);
  expect(p[1]!).toBeGreaterThan(80);
  expect(p[1]!).toBeLessThan(175);
  expect(p[2]!).toBeGreaterThan(80);
  expect(p[2]!).toBeLessThan(175);
});
