import { describe, it, expect } from "vitest";
import { pointToXY, xyToPuck, wheelDisplayColor } from "../src/color/wheel-geometry.js";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe("pointToXY", () => {
  it("center → (0,0)", () => {
    const p = pointToXY(50, 50, 50, 50, 40);
    expect(close(p.x, 0)).toBe(true);
    expect(close(p.y, 0)).toBe(true);
  });
  it("y is up: a point above center → positive y", () => {
    const p = pointToXY(50, 30, 50, 50, 40); // 20px above center, r=40 → y=+0.5
    expect(close(p.x, 0)).toBe(true);
    expect(close(p.y, 0.5)).toBe(true);
  });
  it("right of center → positive x", () => {
    const p = pointToXY(70, 50, 50, 50, 40); // 20px right → x=+0.5
    expect(close(p.x, 0.5)).toBe(true);
  });
  it("clamps magnitude outside the disk to 1", () => {
    const p = pointToXY(200, 50, 50, 50, 40); // far right → clamp to x=1
    expect(close(Math.hypot(p.x, p.y), 1)).toBe(true);
    expect(close(p.x, 1)).toBe(true);
  });
});

describe("xyToPuck is the inverse of pointToXY", () => {
  it("round-trips an interior point", () => {
    const puck = xyToPuck(0.3, -0.4, 50, 50, 40);
    const back = pointToXY(puck.px, puck.py, 50, 50, 40);
    expect(close(back.x, 0.3)).toBe(true);
    expect(close(back.y, -0.4)).toBe(true);
  });
  it("y-up: positive y is ABOVE center (smaller py)", () => {
    const puck = xyToPuck(0, 0.5, 50, 50, 40);
    expect(puck.py).toBeLessThan(50);
  });
});

describe("wheelDisplayColor", () => {
  it("center is near-neutral (low saturation)", () => {
    const c = wheelDisplayColor(0, 0);
    expect(Math.abs(c.r - c.g)).toBeLessThan(0.15);
    expect(Math.abs(c.g - c.b)).toBeLessThan(0.15);
  });
  it("the rim is more saturated than the center", () => {
    const centerSpread = (() => { const c = wheelDisplayColor(0, 0); return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); })();
    const rimSpread = (() => { const c = wheelDisplayColor(0.95, 0); return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); })();
    expect(rimSpread).toBeGreaterThan(centerSpread);
  });
  it("hue rotates with angle (rim at +x differs from rim at -x)", () => {
    const a = wheelDisplayColor(0.95, 0);
    const b = wheelDisplayColor(-0.95, 0);
    expect(a.r !== b.r || a.g !== b.g || a.b !== b.b).toBe(true);
  });
});
