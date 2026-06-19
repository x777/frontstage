import { describe, expect, test } from "vitest";
import { SabRingBuffer } from "../src/audio/ring-buffer.js";

describe("SabRingBuffer", () => {
  test("write then read round-trips interleaved frames", () => {
    const r = SabRingBuffer.create(8, 1);
    expect(r.write(new Float32Array([1, 2, 3]))).toBe(3);
    expect(r.availableRead()).toBe(3);
    const out = new Float32Array(3);
    expect(r.read(out, 3)).toBe(3);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  test("write caps at capacity and wraps", () => {
    const r = SabRingBuffer.create(4, 1);
    const written = r.write(new Float32Array([1, 2, 3, 4, 5]));
    expect(written).toBeLessThanOrEqual(4);
  });

  test("stereo interleaving round-trips", () => {
    const r = SabRingBuffer.create(16, 2);
    const input = new Float32Array([0.1, 0.9, 0.2, 0.8, 0.3, 0.7]); // 3 frames, 2ch interleaved
    expect(r.write(input)).toBe(3);
    expect(r.availableRead()).toBe(3);
    const out = new Float32Array(6);
    expect(r.read(out, 3)).toBe(3);
    for (let i = 0; i < 6; i++) expect(out[i]).toBeCloseTo(input[i]!, 5);
  });

  test("wrap-around reads correctly", () => {
    const r = SabRingBuffer.create(4, 1);
    // Fill 3, read 3, then write crossing boundary
    r.write(new Float32Array([1, 2, 3]));
    const tmp = new Float32Array(3);
    r.read(tmp, 3);
    // Now write 4 values spanning the wrap
    r.write(new Float32Array([10, 20, 30]));
    const out = new Float32Array(3);
    r.read(out, 3);
    expect(Array.from(out)).toEqual([10, 20, 30]);
  });

  test("availableRead returns 0 when empty", () => {
    const r = SabRingBuffer.create(8, 1);
    expect(r.availableRead()).toBe(0);
  });

  test("read returns 0 when empty", () => {
    const r = SabRingBuffer.create(8, 1);
    const out = new Float32Array(4);
    expect(r.read(out, 4)).toBe(0);
  });
});
