import { describe, expect, test } from "vitest";
import { defaultTextStyle, rgbaFromHex } from "../src/text-style.js";

describe("text style", () => {
  test("default font", () => {
    expect(defaultTextStyle().fontName).toBe("Helvetica-Bold");
    expect(defaultTextStyle().fontSize).toBe(96);
  });
  test("hex parsing", () => {
    expect(rgbaFromHex("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(rgbaFromHex("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(rgbaFromHex("#ff000080")?.a).toBeCloseTo(128 / 255);
    expect(rgbaFromHex("nope")).toBe(null);
  });
});
