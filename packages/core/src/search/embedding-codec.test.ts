import { describe, expect, test } from "vitest";
import {
  decodeEmbeddings,
  embeddingRelativePath,
  encodeEmbeddings,
  float16BitsToFloat32,
  float32ToFloat16Bits,
  type EmbeddingHeader,
  type EmbeddingRow,
} from "./embedding-codec.js";

function header(overrides: Partial<EmbeddingHeader> = {}): EmbeddingHeader {
  return { model: "siglip2-base-patch16-256", modelVersion: "onnx-community/siglip2-base-patch16-256", samplerVersion: "1", dim: 4, count: 0, ...overrides };
}

function row(time: number, shotStart: number, shotEnd: number, vector: number[]): EmbeddingRow {
  return { time, shotStart, shotEnd, vector: Float32Array.from(vector) };
}

describe("encodeEmbeddings / decodeEmbeddings", () => {
  test("round-trips header + rows", () => {
    const h = header({ dim: 4 });
    const rows = [row(0.5, 0, 2, [0.1, -0.2, 0.3, -0.4]), row(2.5, 2, 4, [1, -1, 0, 0.5])];
    const bytes = encodeEmbeddings(h, rows);
    const decoded = decodeEmbeddings(bytes);
    expect(decoded).not.toBeNull();
    expect(decoded!.header).toEqual({ ...h, count: 2 });
    expect(decoded!.rows).toHaveLength(2);
    for (let i = 0; i < rows.length; i++) {
      expect(decoded!.rows[i]!.time).toBe(rows[i]!.time); // Float64 — exact
      expect(decoded!.rows[i]!.shotStart).toBe(rows[i]!.shotStart);
      expect(decoded!.rows[i]!.shotEnd).toBe(rows[i]!.shotEnd);
      for (let d = 0; d < h.dim; d++) {
        expect(decoded!.rows[i]!.vector[d]).toBeCloseTo(rows[i]!.vector[d]!, 2); // Float16 lossy
      }
    }
  });

  test("preserves every header field, including string model/sampler versions", () => {
    const h = header({ model: "m", modelVersion: "v-42", samplerVersion: "3", dim: 2 });
    const bytes = encodeEmbeddings(h, [row(0, 0, 0, [1, 2])]);
    const decoded = decodeEmbeddings(bytes)!;
    expect(decoded.header.model).toBe("m");
    expect(decoded.header.modelVersion).toBe("v-42");
    expect(decoded.header.samplerVersion).toBe("3");
    expect(decoded.header.dim).toBe(2);
    expect(decoded.header.count).toBe(1);
  });

  test("count is derived from rows.length, ignoring a mismatched input header.count", () => {
    const h = header({ dim: 1, count: 999 });
    const bytes = encodeEmbeddings(h, [row(0, 0, 0, [1]), row(1, 0, 0, [2])]);
    expect(decodeEmbeddings(bytes)!.header.count).toBe(2);
  });

  test("zero rows round-trips to an empty row list", () => {
    const bytes = encodeEmbeddings(header({ dim: 8 }), []);
    const decoded = decodeEmbeddings(bytes)!;
    expect(decoded.rows).toEqual([]);
    expect(decoded.header.count).toBe(0);
  });

  test("bad magic decodes to null", () => {
    const bytes = encodeEmbeddings(header({ dim: 2 }), [row(0, 0, 0, [1, 2])]);
    const mangled = bytes.slice();
    mangled[0] = 0x00;
    expect(decodeEmbeddings(mangled)).toBeNull();
  });

  test("a truncated buffer (bad row-section length) decodes to null", () => {
    const bytes = encodeEmbeddings(header({ dim: 2 }), [row(0, 0, 0, [1, 2])]);
    expect(decodeEmbeddings(bytes.slice(0, bytes.length - 1))).toBeNull();
  });

  test("a buffer too short to hold the magic + length prefix decodes to null", () => {
    expect(decodeEmbeddings(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test("a header missing a required field decodes to null", () => {
    const magic = new TextEncoder().encode("PALMEMB1");
    const badJson = new TextEncoder().encode(JSON.stringify({ model: "m", dim: 2, count: 0 })); // no modelVersion/samplerVersion
    const buf = new Uint8Array(magic.length + 4 + badJson.length);
    buf.set(magic, 0);
    new DataView(buf.buffer).setUint32(magic.length, badJson.length, true);
    buf.set(badJson, magic.length + 4);
    expect(decodeEmbeddings(buf)).toBeNull();
  });
});

describe("embeddingRelativePath", () => {
  test("matches the media/<id>.embed convention", () => {
    expect(embeddingRelativePath("abc123")).toBe("media/abc123.embed");
  });
});

describe("float32ToFloat16Bits / float16BitsToFloat32", () => {
  const cases: [number, number][] = [
    [0, 0x0000],
    [-0, 0x8000],
    [1, 0x3c00],
    [-1, 0xbc00],
    [2, 0x4000],
    [0.5, 0x3800],
    [65504, 0x7bff], // the largest finite half
  ];

  test.each(cases)("encodes %f as bits 0x%s", (value, expectedBits) => {
    expect(float32ToFloat16Bits(value)).toBe(expectedBits);
  });

  test("subnormals: the smallest positive subnormal round-trips exactly", () => {
    const smallest = Math.pow(2, -24);
    const bits = float32ToFloat16Bits(smallest);
    expect(bits).toBe(0x0001);
    expect(float16BitsToFloat32(bits)).toBeCloseTo(smallest, 10);
  });

  test("subnormals: the largest subnormal round-trips exactly", () => {
    const largestSubnormal = 1023 * Math.pow(2, -24);
    expect(float32ToFloat16Bits(largestSubnormal)).toBe(0x03ff);
  });

  test("65504 clamp: values beyond the finite half range clamp instead of becoming Infinity", () => {
    expect(float32ToFloat16Bits(70000)).toBe(0x7bff);
    expect(float32ToFloat16Bits(-70000)).toBe(0xfbff);
    expect(float32ToFloat16Bits(Infinity)).toBe(0x7bff);
    expect(float32ToFloat16Bits(-Infinity)).toBe(0xfbff);
    expect(Number.isFinite(float16BitsToFloat32(float32ToFloat16Bits(70000)))).toBe(true);
  });

  test("round-to-nearest-even at an exact tie rounds to the even mantissa", () => {
    // 1 + 1.5*2^-10 sits exactly between half-mantissa 1 (odd) and 2 (even) -> rounds to 2.
    const tie = 1 + 1.5 * Math.pow(2, -10);
    expect(float32ToFloat16Bits(tie)).toBe(0x3c02);
  });

  test("round-trips a spread of representative values within half precision (<1% relative error)", () => {
    const values = [0, -0.5, 0.25, -3.75, 100, -12345, 0.001, -0.0001];
    for (const v of values) {
      const back = float16BitsToFloat32(float32ToFloat16Bits(v));
      if (v === 0) {
        expect(back).toBe(0);
      } else {
        expect(Math.abs(back - v) / Math.abs(v)).toBeLessThan(0.01);
      }
    }
  });
});
