import { test, expect } from "vitest";
import { computeFrameHistogram } from "../src/inspector/adjust/frame-histogram.js";

// bin(128) = Math.floor((128/256)*256) = 128; Y for grey-128 = Math.round(128*1.0) = 128
function solidGrey2x2(): Uint8Array {
  const arr = new Uint8Array(4 * 4); // 2×2 × 4 channels
  for (let i = 0; i < 4; i++) {
    arr[i * 4 + 0] = 128; // R
    arr[i * 4 + 1] = 128; // G
    arr[i * 4 + 2] = 128; // B
    arr[i * 4 + 3] = 255; // A
  }
  return arr;
}

test("computeFrameHistogram peaks at bin 128 for solid grey 2×2", async () => {
  const engine = {
    readRGBA: async () => solidGrey2x2(),
    width: 2,
    height: 2,
  };

  const result = await computeFrameHistogram(engine);

  expect(result.y[128]).toBe(4);
  expect(result.r[128]).toBe(4);
  expect(result.g[128]).toBe(4);
  expect(result.b[128]).toBe(4);
});
