import { describe, expect, test } from "vitest";
import {
  cropVisibleWidthFraction,
  defaultTransform,
  snapToBoundary,
  snapToCanvasEdges,
  transformTopLeft,
} from "../src/transform.js";

describe("transform", () => {
  test("topLeft is center minus half-size", () => {
    const t = { ...defaultTransform(), centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.2 };
    expect(transformTopLeft(t)).toEqual({ x: 0.3, y: 0.4 });
  });
  test("crop visible width fraction", () => {
    expect(cropVisibleWidthFraction({ left: 0.1, top: 0, right: 0.2, bottom: 0 })).toBeCloseTo(0.7);
  });
  test("snapToBoundary snaps near 0 and 1", () => {
    expect(snapToBoundary(0.01, 0.05)).toBe(0);
    expect(snapToBoundary(0.98, 0.05)).toBe(1);
    expect(snapToBoundary(0.5, 0.05)).toBe(0.5);
  });
  test("snapToCanvasEdges aligns a near-edge clip to the boundary", () => {
    const t = { ...defaultTransform(), centerX: 0.49, centerY: 0.5, width: 1, height: 1 };
    const snapped = snapToCanvasEdges(t, 0.05);
    expect(transformTopLeft(snapped).x).toBe(0);
  });
});
