import { describe, expect, test } from "vitest";
import { decodeWavPcm16Mono, encodeWavPcm16Mono } from "../src/audio/wav-encode.js";

function readStr(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWavPcm16Mono", () => {
  test("writes an exact 44-byte RIFF/WAVE/fmt/data header", () => {
    const out = encodeWavPcm16Mono(new Float32Array([0, 0, 0, 0]), 16000, 16000);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

    expect(readStr(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 4 * 2); // ChunkSize = 36 + dataSize
    expect(readStr(view, 8, 4)).toBe("WAVE");
    expect(readStr(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size (PCM)
    expect(view.getUint16(20, true)).toBe(1); // audio format: PCM
    expect(view.getUint16(22, true)).toBe(1); // channels: mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint32(28, true)).toBe(16000 * 2); // byte rate = rate * channels * bytesPerSample
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readStr(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(4 * 2); // data chunk size
  });

  test("output length = 44 + ceil(samples * target / input) * 2", () => {
    const samples = new Float32Array(4800); // 0.1s @ 48kHz
    const out = encodeWavPcm16Mono(samples, 48000, 16000);
    const expectedFrames = Math.ceil((4800 * 16000) / 48000); // 1600
    expect(out.length).toBe(44 + expectedFrames * 2);
  });

  test("output length rounds up on a non-integer frame count", () => {
    const samples = new Float32Array(100); // 100 * 16000 / 48000 = 33.33.. → ceil 34
    const out = encodeWavPcm16Mono(samples, 48000, 16000);
    expect(out.length).toBe(44 + 34 * 2);
  });

  test("a 1kHz sine at 48k resamples to 16k within tolerance", () => {
    const inputRate = 48000;
    const targetRate = 16000;
    const freq = 1000;
    const n = 4800; // 0.1s
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * freq * i) / inputRate);

    const out = encodeWavPcm16Mono(samples, inputRate, targetRate);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

    // 48000/16000 = 3 exactly, so output sample i should equal input sample 3*i (no interpolation drift).
    for (const i of [0, 10, 100, 500, 1000]) {
      const decoded = view.getInt16(44 + i * 2, true) / 32767;
      const expected = samples[3 * i]!;
      expect(decoded).toBeCloseTo(expected, 3);
    }
  });

  test("clamps out-of-range samples to int16 bounds", () => {
    const out = encodeWavPcm16Mono(new Float32Array([1.5, -1.5]), 16000, 16000);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe("decodeWavPcm16Mono", () => {
  test("round-trips through encodeWavPcm16Mono: same sample rate, same frame count, values within int16 rounding tolerance", () => {
    const inputRate = 48000;
    const targetRate = 16000;
    const freq = 1000;
    const n = 4800; // 0.1s
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * freq * i) / inputRate);

    const encoded = encodeWavPcm16Mono(samples, inputRate, targetRate);
    const decoded = decodeWavPcm16Mono(encoded);

    expect(decoded.sampleRate).toBe(targetRate);
    const expectedFrames = Math.ceil((n * targetRate) / inputRate);
    expect(decoded.samples.length).toBe(expectedFrames);
    for (const i of [0, 10, 100, 500, 1000]) {
      const expected = samples[3 * i]!; // 48000/16000 = 3 exactly, no interpolation drift
      expect(decoded.samples[i]).toBeCloseTo(expected, 3);
    }
  });

  test("round-trips exact endpoints -1 and 1 without clipping past int16 range", () => {
    const encoded = encodeWavPcm16Mono(new Float32Array([1, -1, 0]), 16000, 16000);
    const decoded = decodeWavPcm16Mono(encoded);
    expect(decoded.samples[0]).toBeCloseTo(1, 4);
    expect(decoded.samples[1]).toBeCloseTo(-1, 4);
    expect(decoded.samples[2]).toBeCloseTo(0, 4);
  });

  test("reads sampleRate/channels/bitsPerSample from the fmt chunk", () => {
    const encoded = encodeWavPcm16Mono(new Float32Array([0, 0, 0, 0]), 16000, 8000);
    const decoded = decodeWavPcm16Mono(encoded);
    expect(decoded.sampleRate).toBe(8000);
    expect(decoded.samples.length).toBe(2); // ceil(4 * 8000 / 16000)
  });

  test("throws on a non-RIFF/WAVE buffer", () => {
    expect(() => decodeWavPcm16Mono(new Uint8Array(20))).toThrow(/RIFF\/WAVE/);
  });

  test("throws on a truncated buffer (no fmt/data chunks)", () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(() => decodeWavPcm16Mono(bytes)).toThrow(/fmt or data/);
  });

  test("throws on a non-mono fmt chunk", () => {
    // Hand-build a minimal stereo 16-bit WAV header (channels=2) with an empty data chunk.
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // channels: stereo
    view.setUint32(24, 16000, true);
    view.setUint32(28, 64000, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, 0, true);
    expect(() => decodeWavPcm16Mono(new Uint8Array(buffer))).toThrow(/mono/);
  });
});
