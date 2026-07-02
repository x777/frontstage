import { describe, expect, it } from "vitest";
import { downmixToMono } from "../src/web-audio-extract.js";

// WebCodecs (AudioDecoder/EncodedAudioChunk) isn't available under vitest's node
// environment, so makeWebAudioExtractor itself is typecheck-only — this exercises
// its pure downmix math, which is what the plan carves out as unit-testable.
describe("downmixToMono", () => {
  it("passes mono input through unchanged", () => {
    const mono = new Float32Array([0.1, 0.2, 0.3]);
    expect(downmixToMono(mono, 1)).toBe(mono);
  });

  it("averages stereo channels per frame", () => {
    // 2 frames, interleaved [L, R, L, R]
    const stereo = new Float32Array([1, -1, 0.5, 0.5]);
    const mono = downmixToMono(stereo, 2);
    expect(Array.from(mono)).toEqual([0, 0.5]);
  });

  it("averages a multi-channel (5.1-style) buffer", () => {
    const channels = 6;
    // 1 frame, all channels = 0.6 → average 0.6
    const buf = new Float32Array(channels).fill(0.6);
    const mono = downmixToMono(buf, channels);
    expect(mono.length).toBe(1);
    expect(mono[0]).toBeCloseTo(0.6, 6);
  });
});
