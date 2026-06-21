import { describe, expect, test } from "vitest";
import { mixWindow, type MixSource } from "../src/audio/mix.js";

const src = (val: number, n: number, startFrame = 0): MixSource => ({
  pcm: new Float32Array(n).fill(val),
  channels: 1,
  sampleRate: 100,
  startFrame,
  endFrame: 1000,
  trimStartFrame: 0,
  speed: 1,
});

test("sums two overlapping sources and clamps", () => {
  const out = mixWindow([src(0.6, 100), src(0.6, 100)], 0, 10, 100, 30, () => 1);
  expect(out[0]).toBeCloseTo(1.0); // 0.6+0.6 = 1.2 → clamped to 1
});

test("applies per-source gain", () => {
  const out = mixWindow([src(0.8, 100)], 0, 10, 100, 30, () => 0.5);
  expect(out[0]).toBeCloseTo(0.4);
});

test("a source contributes only while active (startFrame)", () => {
  // src starts at timelineFrame 5; at output sample 0 (frame 0) it is silent
  const s = src(0.5, 1000, 5);
  const out = mixWindow([s], 0, 10, 100, 30, () => 1);
  expect(out[0]).toBeCloseTo(0); // frame 0 < startFrame 5 → silent
});

test("trimStartFrame and speed map to the correct source sample", () => {
  // Build a ramp PCM: pcm[i] = i/100 so we can predict the sampled value.
  // source: sampleRate=100, fps=30, startFrame=0, endFrame=1000, trimStartFrame=10, speed=1
  // At output sample s=0 (timelineSample=0, timelineFrame=0):
  //   srcSec = (0/100 - 0/30)*1 + 10/30 = 10/30
  //   srcIdx = round((10/30)*100) = round(33.333) = 33
  //   pcm[33] = 33/100 = 0.33
  const n = 200;
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = i / 100;

  const rampSrc: MixSource = {
    pcm,
    channels: 1,
    sampleRate: 100,
    startFrame: 0,
    endFrame: 1000,
    trimStartFrame: 10,
    speed: 1,
  };

  const out = mixWindow([rampSrc], 0, 1, 100, 30, () => 1);
  // srcIdx = round(10/30 * 100) = round(33.333) = 33; pcm[33] = 0.33
  expect(out[0]).toBeCloseTo(33 / 100, 3);
});

describe("edge cases", () => {
  test("returns silence for no sources", () => {
    const out = mixWindow([], 0, 4, 100, 30, () => 1);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  test("source past its endFrame is silent", () => {
    const s: MixSource = { ...src(0.9, 100), startFrame: 0, endFrame: 1 };
    // At sample 0, timelineFrame = floor(0/100*30) = 0 — active (0 < 1)
    // At sample 4, timelineFrame = floor(4/100*30) = floor(1.2) = 1 — inactive (1 >= 1)
    const out = mixWindow([s], 0, 10, 100, 30, () => 1);
    expect(out[0]).toBeCloseTo(0.9);
    expect(out[4]).toBeCloseTo(0);
  });

  test("speed=2 doubles the source read rate", () => {
    // pcm is a ramp; speed=2 means srcSec advances at 2x rate
    const n = 200;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = i / 100;

    const fastSrc: MixSource = {
      pcm,
      channels: 1,
      sampleRate: 100,
      startFrame: 0,
      endFrame: 1000,
      trimStartFrame: 0,
      speed: 2,
    };

    // At sample s=1 (timelineSample=1):
    //   srcSec = (1/100 - 0/30)*2 + 0 = 0.02
    //   srcIdx = round(0.02 * 100) = 2
    //   pcm[2] = 0.02
    const out = mixWindow([fastSrc], 0, 2, 100, 30, () => 1);
    expect(out[1]).toBeCloseTo(0.02, 3);
  });
});
