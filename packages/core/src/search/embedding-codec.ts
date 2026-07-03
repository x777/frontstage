// Pure port of Swift's EmbeddingStore (Search/Indexing/EmbeddingStore.swift): the PALMEMB1 binary
// format — magic + a length-prefixed JSON header + fixed-width rows of (time, shotStart, shotEnd) as
// little-endian Float64 followed by dim little-endian Float16 vector components. Swift writes native
// (little-endian on arm64) byte order for every multi-byte field; this port matches it explicitly.
//
// Deviation from Swift: `modelVersion`/`samplerVersion` are strings here (a resolved checkpoint id /
// sampler version tag), not Swift's integer version numbers — the JS model ecosystem identifies
// checkpoints by string, not an incrementing int. This only affects the JSON header payload, not the
// fixed binary row layout, so it doesn't change PALMEMB1's on-disk shape.

const MAGIC = "PALMEMB1";
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
const ROW_HEADER_BYTES = 24; // time, shotStart, shotEnd — Float64 each
const HALF_MAX = 65504; // largest finite Float16 magnitude

export interface EmbeddingHeader {
  model: string;
  modelVersion: string;
  samplerVersion: string;
  dim: number;
  count: number;
}

export interface EmbeddingRow {
  time: number;
  shotStart: number;
  shotEnd: number;
  vector: Float32Array;
}

export function embeddingRelativePath(mediaId: string): string {
  return `media/${mediaId}.embed`;
}

export function encodeEmbeddings(header: EmbeddingHeader, rows: EmbeddingRow[]): Uint8Array {
  const fullHeader: EmbeddingHeader = { ...header, count: rows.length };
  const json = new TextEncoder().encode(JSON.stringify(fullHeader));
  const rowBytes = ROW_HEADER_BYTES + fullHeader.dim * 2;
  const buf = new Uint8Array(MAGIC_BYTES.length + 4 + json.length + rows.length * rowBytes);
  const view = new DataView(buf.buffer);

  let offset = 0;
  buf.set(MAGIC_BYTES, offset);
  offset += MAGIC_BYTES.length;
  view.setUint32(offset, json.length, true);
  offset += 4;
  buf.set(json, offset);
  offset += json.length;

  for (const row of rows) {
    view.setFloat64(offset, row.time, true);
    view.setFloat64(offset + 8, row.shotStart, true);
    view.setFloat64(offset + 16, row.shotEnd, true);
    offset += ROW_HEADER_BYTES;
    for (let d = 0; d < fullHeader.dim; d++) {
      view.setUint16(offset, float32ToFloat16Bits(row.vector[d] ?? 0), true);
      offset += 2;
    }
  }
  return buf;
}

export function decodeEmbeddings(bytes: Uint8Array): { header: EmbeddingHeader; rows: EmbeddingRow[] } | null {
  if (bytes.length < MAGIC_BYTES.length + 4) return null;
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (bytes[i] !== MAGIC_BYTES[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = MAGIC_BYTES.length;
  const jsonLen = view.getUint32(offset, true);
  offset += 4;
  if (jsonLen < 0 || bytes.length < offset + jsonLen) return null;

  let header: EmbeddingHeader;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + jsonLen)));
    const valid = parseHeader(parsed);
    if (valid === null) return null;
    header = valid;
  } catch {
    return null;
  }
  offset += jsonLen;

  if (header.dim < 0 || header.count < 0) return null;
  const rowBytes = ROW_HEADER_BYTES + header.dim * 2;
  if (bytes.length !== offset + header.count * rowBytes) return null;

  const rows: EmbeddingRow[] = [];
  for (let i = 0; i < header.count; i++) {
    const base = offset + i * rowBytes;
    const time = view.getFloat64(base, true);
    const shotStart = view.getFloat64(base + 8, true);
    const shotEnd = view.getFloat64(base + 16, true);
    const vector = new Float32Array(header.dim);
    for (let d = 0; d < header.dim; d++) {
      vector[d] = float16BitsToFloat32(view.getUint16(base + 24 + d * 2, true));
    }
    rows.push({ time, shotStart, shotEnd, vector });
  }
  return { header, rows };
}

function parseHeader(x: unknown): EmbeddingHeader | null {
  if (typeof x !== "object" || x === null) return null;
  const h = x as Record<string, unknown>;
  if (typeof h.model !== "string") return null;
  if (typeof h.modelVersion !== "string") return null;
  if (typeof h.samplerVersion !== "string") return null;
  if (typeof h.dim !== "number") return null;
  if (typeof h.count !== "number") return null;
  return { model: h.model, modelVersion: h.modelVersion, samplerVersion: h.samplerVersion, dim: h.dim, count: h.count };
}

// --- Float16 (round-to-nearest-even), clamped to +-65504 instead of overflowing to Infinity ---

const f32Buf = new Float32Array(1);
const u32Buf = new Uint32Array(f32Buf.buffer);

export function float32ToFloat16Bits(value: number): number {
  f32Buf[0] = value;
  const bits = u32Buf[0]!;
  const sign = (bits >>> 31) & 1;

  if (Number.isNaN(value)) return (sign << 15) | 0x7e00;

  const exp32 = (bits >>> 23) & 0xff;
  const mant32 = bits & 0x7fffff;
  if (exp32 === 0 && mant32 === 0) return sign << 15; // +-0
  if (Math.abs(value) > HALF_MAX) return (sign << 15) | 0x7bff; // clamp overflow/Infinity to the finite max

  let exp: number;
  let implicit: number;
  if (exp32 === 0) {
    exp = -126; // float32 subnormal
    implicit = 0;
  } else {
    exp = exp32 - 127;
    implicit = 1;
  }
  const sig = (implicit << 23) | mant32; // 24-bit significand
  let newExp = exp + 15; // half-biased exponent if normalized as 1.xxxx * 2^exp

  if (newExp >= 1) {
    let mantissa10 = sig >>> 13;
    const roundBit = (sig >>> 12) & 1;
    const sticky = sig & 0xfff;
    if (roundBit === 1 && (sticky !== 0 || (mantissa10 & 1) !== 0)) {
      mantissa10 += 1;
      if (mantissa10 === 0x400) {
        mantissa10 = 0;
        newExp += 1;
        if (newExp >= 31) return (sign << 15) | 0x7bff;
      }
    }
    return (sign << 15) | (newExp << 10) | (mantissa10 & 0x3ff);
  }

  // Subnormal (or zero) half result.
  const shift = 14 - newExp;
  if (shift > 24) return sign << 15;
  let mantissa10 = sig >>> shift;
  const roundBitPos = shift - 1;
  const roundBit = (sig >>> roundBitPos) & 1;
  const sticky = sig & ((1 << roundBitPos) - 1);
  if (roundBit === 1 && (sticky !== 0 || (mantissa10 & 1) !== 0)) mantissa10 += 1;
  if (mantissa10 === 0x400) return (sign << 15) | (1 << 10); // rounded up into the smallest normal
  return (sign << 15) | (mantissa10 & 0x3ff);
}

export function float16BitsToFloat32(bitsIn: number): number {
  const sign = (bitsIn >>> 15) & 1;
  const exp = (bitsIn >>> 10) & 0x1f;
  const mant = bitsIn & 0x3ff;
  let value: number;
  if (exp === 0) {
    value = mant * Math.pow(2, -24);
  } else if (exp === 0x1f) {
    value = mant === 0 ? Infinity : NaN;
  } else {
    value = (1 + mant / 1024) * Math.pow(2, exp - 15);
  }
  return sign === 1 ? -value : value;
}
