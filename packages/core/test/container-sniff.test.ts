import { describe, expect, test } from "vitest";
import { sniffIsoBmff } from "../src/index.js";

function ftypBytes(brand = "isom"): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0x00, 0x00, 0x00, 0x20], 0); // box size
  b.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
  b.set([...brand].map((c) => c.charCodeAt(0)), 8);
  return b;
}

describe("sniffIsoBmff", () => {
  test("detects an mp4 ftyp box", () => {
    expect(sniffIsoBmff(ftypBytes())).toBe(true);
  });

  test("rejects mp3 (ID3 header)", () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffIsoBmff(mp3)).toBe(false);
  });

  test("rejects mp3 (bare frame sync)", () => {
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffIsoBmff(mp3)).toBe(false);
  });

  test("rejects wav (RIFF)", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffIsoBmff(wav)).toBe(false);
  });

  test("rejects buffers too short for a box header", () => {
    expect(sniffIsoBmff(new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79]))).toBe(false);
    expect(sniffIsoBmff(new Uint8Array(0))).toBe(false);
  });
});
