import { describe, expect, test } from "vitest";
import {
  normalizeWaveformPeak,
  peakEnvelopeFromPcm,
  waveformColumnsForWidth,
  WAVEFORM_NOISE_FLOOR_DB,
} from "../src/index.js";

describe("normalizeWaveformPeak", () => {
  test("orientation is 0 = loud, 1 = silence", () => {
    expect(normalizeWaveformPeak(0)).toBe(1);
    expect(normalizeWaveformPeak(-0)).toBe(1);
    expect(normalizeWaveformPeak(1)).toBe(0);
    const half = normalizeWaveformPeak(Math.pow(10, WAVEFORM_NOISE_FLOOR_DB / 40));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(normalizeWaveformPeak(1)).toBeLessThan(normalizeWaveformPeak(0.001));
  });
});

describe("peakEnvelopeFromPcm", () => {
  test("known full-scale then silence PCM yields non-empty 0=loud / 1=silence series", () => {
    const sampleRate = 16_000;
    const pcm = new Float32Array(sampleRate); // 1 second
    for (let i = 0; i < 8_000; i++) pcm[i] = i % 2 === 0 ? 1 : -1;
    // second half remains 0 (silence)
    const samples = peakEnvelopeFromPcm(pcm, sampleRate);
    expect(samples.length).toBeGreaterThan(0);
    const mid = Math.floor(samples.length / 2);
    const loud = samples.slice(0, Math.max(1, mid - 2));
    const quiet = samples.slice(mid + 2);
    expect(loud.every((s) => s < 0.05)).toBe(true);
    expect(quiet.every((s) => s > 0.95)).toBe(true);
    expect(Math.min(...samples)).toBeLessThan(Math.max(...samples));
  });
});

describe("waveformColumnsForWidth", () => {
  test("maps a loud-then-silent envelope onto pixel columns preserving orientation", () => {
    const samples = [...Array(100).fill(0), ...Array(100).fill(1)];
    const cols = waveformColumnsForWidth(samples, 10);
    expect(cols).toHaveLength(10);
    expect(cols[0]).toBe(0);
    expect(cols[cols.length - 1]).toBe(1);
  });
});
