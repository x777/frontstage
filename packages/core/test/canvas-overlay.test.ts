import { describe, expect, test } from "vitest";
import {
  CANVAS_FORMAT_ASPECT,
  CANVAS_FORMAT_KINDS,
  CANVAS_GRID_PRESETS,
  canvasFormatContentRect,
  canvasGridLinePositions,
  canvasGuideSafeZoneInset,
  canvasOutsideRects,
  canvasOverlayIsEmpty,
  clearCanvasOverlaySelection,
  emptyCanvasOverlaySelection,
} from "../src/preview/canvas-overlay.js";

describe("Canvas viewing overlays", () => {
  test("grid presets provide two through five divisions", () => {
    expect([...CANVAS_GRID_PRESETS]).toEqual([2, 3, 4, 5]);
  });

  test.each([...CANVAS_GRID_PRESETS])("grid %i positions create one fewer line than divisions", (grid) => {
    const positions = canvasGridLinePositions(grid);
    expect(positions).toHaveLength(grid - 1);
    expect(positions.every((p) => p > 0 && p < 1)).toBe(true);
  });

  test("safe zone insets match action and title standards", () => {
    expect(canvasGuideSafeZoneInset("actionSafe")).toBe(0.035);
    expect(canvasGuideSafeZoneInset("titleSafe")).toBe(0.05);
    expect(canvasGuideSafeZoneInset("center")).toBeUndefined();
  });

  test.each([...CANVAS_FORMAT_KINDS])("format %s is centered and preserves its aspect", (format) => {
    const canvas = { width: 1920, height: 1080 };
    const rect = canvasFormatContentRect(CANVAS_FORMAT_ASPECT[format], canvas);
    expect(Math.abs(rect.x + rect.width / 2 - canvas.width / 2)).toBeLessThan(0.0001);
    expect(Math.abs(rect.y + rect.height / 2 - canvas.height / 2)).toBeLessThan(0.0001);
    expect(Math.abs(rect.width / rect.height - CANVAS_FORMAT_ASPECT[format])).toBeLessThan(0.0001);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(canvas.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(canvas.height);
  });

  test("matching format has no outside mask", () => {
    const size = { width: 1080, height: 1080 };
    const content = canvasFormatContentRect(CANVAS_FORMAT_ASPECT.square, size);
    expect(canvasOutsideRects(content, size)).toEqual([]);
  });

  test("clearing selection removes every overlay category", () => {
    const selection = {
      grid: 3 as const,
      guides: new Set(["actionSafe", "center"] as const),
      format: "scope" as const,
    };
    expect(canvasOverlayIsEmpty(selection)).toBe(false);
    const cleared = clearCanvasOverlaySelection();
    expect(canvasOverlayIsEmpty(cleared)).toBe(true);
    expect(canvasOverlayIsEmpty(emptyCanvasOverlaySelection())).toBe(true);
  });
});
