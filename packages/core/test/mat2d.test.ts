import { describe, expect, test } from "vitest";
import { affineTransform, mat2dApply, mat2dInvert, mat2dMultiply, type Mat2d } from "../src/mat2d.js";
import { defaultTransform } from "../src/transform.js";

const close = (m: Mat2d, e: Partial<Mat2d>) => {
  for (const k of Object.keys(e) as (keyof Mat2d)[]) expect(m[k]).toBeCloseTo(e[k]!);
};

describe("mat2d", () => {
  test("multiply applies m then n (translate then scale)", () => {
    const t = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 };
    const s = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    // apply translate(10,20) first, then scale x2 → point (0,0) → (10,20) → (20,40)
    expect(mat2dMultiply(t, s)).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 20, f: 40 });
  });
  test("full-canvas clip with matching sizes is identity", () => {
    close(affineTransform(defaultTransform(), { width: 100, height: 100 }, { width: 100, height: 100 }),
      { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });
  test("half-size centered clip scales and offsets", () => {
    const t = { ...defaultTransform(), width: 0.5, height: 0.5 };
    close(affineTransform(t, { width: 100, height: 100 }, { width: 100, height: 100 }),
      { a: 0.5, d: 0.5, e: 25, f: 25 });
  });
  test("horizontal flip negates x scale and shifts origin", () => {
    const t = { ...defaultTransform(), flipHorizontal: true };
    close(affineTransform(t, { width: 100, height: 100 }, { width: 100, height: 100 }),
      { a: -1, e: 100 });
  });
  test("vertical flip negates y scale and shifts y origin", () => {
    const t = { ...defaultTransform(), flipVertical: true };
    close(affineTransform(t, { width: 100, height: 100 }, { width: 100, height: 100 }),
      { a: 1, d: -1, f: 100 });
  });
  test("90-degree rotation produces the expected rotation sub-matrix", () => {
    const t = { ...defaultTransform(), rotation: 90 };
    // placed is identity (full-canvas, matching sizes); center-pivot translates only affect e/f,
    // so a,b,c,d are the pure 90 deg CW rotation in this matrix convention.
    close(affineTransform(t, { width: 100, height: 100 }, { width: 100, height: 100 }),
      { a: 0, b: 1, c: -1, d: 0 });
  });
});

describe("mat2dInvert / mat2dApply", () => {
  test("inverse of a scale+translate round-trips a point", () => {
    const m: Mat2d = { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 };
    const inv = mat2dInvert(m)!;
    const p = mat2dApply(m, { x: 5, y: 7 });
    const back = mat2dApply(inv, p);
    expect(back.x).toBeCloseTo(5);
    expect(back.y).toBeCloseTo(7);
  });

  test("inverse of a rotated+scaled transform round-trips a point", () => {
    const half = { ...defaultTransform(), width: 0.5, height: 0.5, rotation: 37 };
    const m = affineTransform(half, { width: 200, height: 150 }, { width: 400, height: 300 });
    const inv = mat2dInvert(m)!;
    const p = mat2dApply(m, { x: 80, y: 40 });
    const back = mat2dApply(inv, p);
    expect(back.x).toBeCloseTo(80);
    expect(back.y).toBeCloseTo(40);
  });

  test("returns null for a degenerate (zero-area) matrix", () => {
    expect(mat2dInvert({ a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull();
  });
});
