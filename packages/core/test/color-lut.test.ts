import { describe, it, expect } from "vitest";
import { parseCubeLUT, sampleLUT } from "../src/color/lut.js";

// identity 2x2x2 cube: 8 nodes, value == normalized coord
const IDENTITY_2 = `LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1`;

describe("parseCubeLUT", () => {
  it("parses a 3D cube as RGBA float32 (alpha=1, stride 4)", () => {
    const lut = parseCubeLUT(IDENTITY_2)!;
    expect(lut.dimension).toBe(2);
    expect(lut.data.length).toBe(2 * 2 * 2 * 4);
    expect(lut.data[3]).toBe(1); // first node alpha
  });
  it("rejects 1D and oversize", () => {
    expect(parseCubeLUT("LUT_1D_SIZE 4\n0 0 0\n1 1 1")).toBeNull();
    expect(parseCubeLUT("LUT_3D_SIZE 65")).toBeNull();
  });
  it("normalizes by DOMAIN_MIN/MAX", () => {
    const lut = parseCubeLUT(`DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\nLUT_3D_SIZE 2\n0 0 0\n2 0 0\n0 2 0\n2 2 0\n0 0 2\n2 0 2\n0 2 2\n2 2 2`)!;
    expect(lut.data[4]).toBeCloseTo(1, 5); // second node R = 2 normalized by /2 = 1
  });
});

describe("sampleLUT", () => {
  it("identity cube returns the input", () => {
    const lut = parseCubeLUT(IDENTITY_2)!;
    const out = sampleLUT(lut, { r: 0.3, g: 0.6, b: 0.9 });
    expect(out.r).toBeCloseTo(0.3, 4);
    expect(out.g).toBeCloseTo(0.6, 4);
    expect(out.b).toBeCloseTo(0.9, 4);
  });
});
