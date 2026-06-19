import { describe, expect, test } from "vitest";
import { affineTransform, mat2dMultiply, type Mat2d } from "../src/mat2d.js";
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
});
