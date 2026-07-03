import { describe, expect, test } from "vitest";
import { matteName, matteSize, MATTE_ASPECTS, type MatteAspect } from "../src/media/matte.js";

// Pinned against Swift Models/Matte.swift's MatteAspect.pixelSize/Matte.even/Matte.fit.
// Both timelines share the same short edge (1080), so every non-project aspect (fit is computed
// from min(w, h)) produces identical dimensions for both orientations — only "project" differs.

describe("matteSize — 1920x1080 timeline", () => {
  const cases: Array<[MatteAspect, number, number]> = [
    ["project", 1920, 1080],
    ["16:9", 1920, 1080],
    ["9:16", 1080, 1920],
    ["1:1", 1080, 1080],
    ["4:3", 1440, 1080],
    ["9:14", 1080, 1680],
    ["2.4:1", 2592, 1080],
  ];

  for (const [aspect, width, height] of cases) {
    test(`${aspect} -> ${width}x${height}`, () => {
      expect(matteSize(aspect, 1920, 1080)).toEqual({ width, height });
    });
  }
});

describe("matteSize — 1080x1920 timeline", () => {
  const cases: Array<[MatteAspect, number, number]> = [
    ["project", 1080, 1920],
    ["16:9", 1920, 1080],
    ["9:16", 1080, 1920],
    ["1:1", 1080, 1080],
    ["4:3", 1440, 1080],
    ["9:14", 1080, 1680],
    ["2.4:1", 2592, 1080],
  ];

  for (const [aspect, width, height] of cases) {
    test(`${aspect} -> ${width}x${height}`, () => {
      expect(matteSize(aspect, 1080, 1920)).toEqual({ width, height });
    });
  }
});

describe("matteSize — even-rounding edge cases", () => {
  test("project: odd timeline dims round down to even (Swift Matte.even)", () => {
    expect(matteSize("project", 1921, 1081)).toEqual({ width: 1920, height: 1080 });
  });

  test("project: dims below 2 clamp up to 2", () => {
    expect(matteSize("project", 1, 1)).toEqual({ width: 2, height: 2 });
  });

  test("16:9 fit: odd result rounds down to even", () => {
    // short edge 101 -> width = round(101*16/9) = round(179.55..) = 180 (already even); height = 101 -> even -> 100
    expect(matteSize("16:9", 101, 200)).toEqual({ width: 180, height: 100 });
  });
});

describe("matteName", () => {
  test("project: 'Matte · WxH' using × (U+00D7), not 'x'", () => {
    expect(matteName("project", 1920, 1080)).toBe("Matte · 1920×1080");
  });

  test("non-project: 'Matte · <aspect>' using the aspect's own label", () => {
    expect(matteName("16:9", 1920, 1080)).toBe("Matte · 16:9");
    expect(matteName("9:16", 1080, 1920)).toBe("Matte · 9:16");
    expect(matteName("2.4:1", 2592, 1080)).toBe("Matte · 2.4:1");
  });
});

test("MATTE_ASPECTS lists all 7 in Swift's MatteAspect.allCases order", () => {
  expect(MATTE_ASPECTS).toEqual(["project", "16:9", "9:16", "1:1", "4:3", "9:14", "2.4:1"]);
});
