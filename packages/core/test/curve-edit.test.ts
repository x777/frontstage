import { describe, it, expect } from "vitest";
import { displayPoints, nearestPoint, addPoint, movePoint, removePoint, evalPolyline, isIdentityCurve } from "../src/color/curve-edit.js";

describe("curve-edit", () => {
  it("displayPoints returns identity for empty", () => {
    expect(displayPoints([])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
  it("nearestPoint finds within radius, else -1", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(nearestPoint(pts, 0.51, 0.49, 0.1)).toBe(1);
    expect(nearestPoint(pts, 0.3, 0.9, 0.05)).toBe(-1);
  });
  it("addPoint inserts sorted by x", () => {
    const { points, index } = addPoint([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.5, 0.7);
    expect(points.map((p) => p.x)).toEqual([0, 0.5, 1]);
    expect(index).toBe(1);
  });
  it("movePoint: endpoint keeps x, moves y", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const moved = movePoint(pts, 0, 0.4, 0.3); // try to drag endpoint 0 rightward
    expect(moved[0]!.x).toBe(0); // x pinned
    expect(moved[0]!.y).toBe(0.3);
  });
  it("movePoint: interior clamps x between neighbors", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    const moved = movePoint(pts, 1, 2, 0.5); // try to drag past the right neighbor
    expect(moved[1]!.x).toBeLessThanOrEqual(1 - 0.001);
    expect(moved[1]!.x).toBeGreaterThanOrEqual(0 + 0.001);
  });
  it("removePoint: interior only, min 2", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(removePoint(pts, 1).map((p) => p.x)).toEqual([0, 1]);
    expect(removePoint(pts, 0)).toEqual(pts); // can't remove endpoint
    expect(removePoint([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0)).toHaveLength(2); // min 2
  });
  it("evalPolyline samples monotonic x", () => {
    const line = evalPolyline([], 4);
    expect(line).toHaveLength(5);
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[4]!.x).toBe(1);
  });
  it("isIdentityCurve", () => {
    expect(isIdentityCurve([])).toBe(true);
    expect(isIdentityCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
    expect(isIdentityCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }])).toBe(false);
  });
});
