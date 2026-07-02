import { describe, expect, test } from "vitest";
import { encodeWavPcm16Mono } from "../src/audio/wav-encode.js";

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
