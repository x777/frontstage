import { describe, expect, test } from "vitest";
import { assignShots, candidateTimes, gridDiff, lumaGrid8x8 } from "./frame-sampler.js";

function solidRGBA(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe("lumaGrid8x8", () => {
  test("a solid-color 8x8 image yields the same luma in every cell", () => {
    // r=g=b so luma == the channel value (0.299+0.587+0.114 == 1.0).
    const rgba = solidRGBA(8, 8, 140, 140, 140);
    const grid = lumaGrid8x8(rgba, 8, 8);
    expect(grid.length).toBe(64);
    for (const v of grid) expect(v).toBeCloseTo(140, 5);
  });

  test("a per-column gradient (1px per cell) reproduces each column's luma exactly per cell", () => {
    const width = 8;
    const height = 8;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = x * 10; // r=g=b -> luma == v
        const i = (y * width + x) * 4;
        rgba[i] = v;
        rgba[i + 1] = v;
        rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    }
    const grid = lumaGrid8x8(rgba, width, height);
    for (let cellY = 0; cellY < 8; cellY++) {
      for (let cellX = 0; cellX < 8; cellX++) {
        expect(grid[cellY * 8 + cellX]).toBeCloseTo(cellX * 10, 5);
      }
    }
  });

  test("averages multiple pixels per cell", () => {
    // 16x16 -> 2x2 px per cell; each 2x2 block has luma values {0, 0, 0, 100} at cell (0,0) -> mean 25.
    const width = 16;
    const height = 16;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const setPixel = (x: number, y: number, v: number) => {
      const i = (y * width + x) * 4;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    };
    setPixel(0, 0, 0);
    setPixel(1, 0, 0);
    setPixel(0, 1, 0);
    setPixel(1, 1, 100);
    const grid = lumaGrid8x8(rgba, width, height);
    expect(grid[0]).toBeCloseTo(25, 5);
  });

  test("degenerate 0x0 input yields an all-zero grid without throwing", () => {
    const grid = lumaGrid8x8(new Uint8ClampedArray(0), 0, 0);
    expect(grid.length).toBe(64);
    for (const v of grid) expect(v).toBe(0);
  });
});

describe("gridDiff", () => {
  test("is zero for identical grids", () => {
    const a = Float32Array.from({ length: 64 }, (_, i) => i);
    expect(gridDiff(a, a)).toBe(0);
  });

  test("is symmetric", () => {
    const a = Float32Array.from({ length: 64 }, (_, i) => i * 1.7);
    const b = Float32Array.from({ length: 64 }, (_, i) => (63 - i) * 0.3);
    expect(gridDiff(a, b)).toBeCloseTo(gridDiff(b, a), 6);
  });

  test("is the mean absolute per-cell difference", () => {
    const a = new Float32Array(64).fill(0);
    const b = new Float32Array(64).fill(1);
    expect(gridDiff(a, b)).toBeCloseTo(1, 6);
  });
});

describe("candidateTimes", () => {
  test("2s interval below the high-res edge", () => {
    expect(candidateTimes({ durationSec: 10, longEdgePx: 100 })).toEqual([1, 3, 5, 7, 9]);
  });

  test("doubles the interval at exactly the 3000px long edge (Swift's >= comparison)", () => {
    expect(candidateTimes({ durationSec: 10, longEdgePx: 3000 })).toEqual([2, 6]);
  });

  test("does not double just below the high-res edge", () => {
    expect(candidateTimes({ durationSec: 10, longEdgePx: 2999 })).toEqual([1, 3, 5, 7, 9]);
  });

  test("doubles above the high-res edge too", () => {
    expect(candidateTimes({ durationSec: 10, longEdgePx: 4000 })).toEqual([2, 6]);
  });

  test("a duration shorter than one interval falls back to the midpoint", () => {
    expect(candidateTimes({ durationSec: 1, longEdgePx: 100 })).toEqual([0.5]);
  });

  test("zero duration yields no candidates", () => {
    expect(candidateTimes({ durationSec: 0, longEdgePx: 100 })).toEqual([]);
  });

  test("negative duration yields no candidates", () => {
    expect(candidateTimes({ durationSec: -5, longEdgePx: 100 })).toEqual([]);
  });
});

describe("assignShots", () => {
  test("a scene cut starts a new shot at the cut time", () => {
    const times = [1, 3, 5];
    const isSceneChange = (i: number) => i === 2;
    expect(assignShots(times, isSceneChange)).toEqual([
      { timeSec: 1, shotStart: 0, shotEnd: 5 },
      { timeSec: 5, shotStart: 5, shotEnd: 5 },
    ]);
  });

  test("an 8s static run (no scene changes) still gets re-sampled by the coverage floor, same shot", () => {
    const times = [1, 3, 5, 7, 9, 11, 13];
    const isSceneChange = () => false;
    expect(assignShots(times, isSceneChange)).toEqual([
      { timeSec: 1, shotStart: 0, shotEnd: 0 },
      { timeSec: 9, shotStart: 0, shotEnd: 0 },
    ]);
  });

  test("a single-candidate range (the image case) yields a zero-length shot", () => {
    expect(assignShots([0], () => false)).toEqual([{ timeSec: 0, shotStart: 0, shotEnd: 0 }]);
  });

  test("empty input yields no shots", () => {
    expect(assignShots([], () => false)).toEqual([]);
  });

  test("the first candidate always starts shot 0 regardless of the predicate", () => {
    expect(assignShots([2], () => false)).toEqual([{ timeSec: 2, shotStart: 0, shotEnd: 0 }]);
  });

  test("a custom coverage floor is honored", () => {
    const times = [1, 2, 3, 4, 5];
    expect(assignShots(times, () => false, 3)).toEqual([
      { timeSec: 1, shotStart: 0, shotEnd: 0 },
      { timeSec: 4, shotStart: 0, shotEnd: 0 },
    ]);
  });

  test("multiple shots each keep their own floor-triggered samples", () => {
    // shot 0: [0,4), scene cut at 8, shot 1 continues without further cuts, floor keeps 16.
    const times = [0, 4, 8, 12, 16];
    const isSceneChange = (i: number) => i === 2; // cut at t=8
    expect(assignShots(times, isSceneChange, 8)).toEqual([
      { timeSec: 0, shotStart: 0, shotEnd: 8 },
      { timeSec: 8, shotStart: 8, shotEnd: 8 },
      { timeSec: 16, shotStart: 8, shotEnd: 8 },
    ]);
  });
});
