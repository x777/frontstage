import { describe, it, expect } from "vitest";
import { timecodeFrames, roundHalfAwayFromZero, type SourceTimecode } from "../../src/interop/source-timecode.js";

describe("timecodeFrames (Swift SourceTimecode.frames(atFPS:))", () => {
  it("converts quanta-rate frame to fps-frame units at 1:1 rate", () => {
    const tc: SourceTimecode = { frame: 744, quanta: 50, dropFrame: false };
    expect(timecodeFrames(tc, 50)).toBe(744);
  });

  it("scales proportionally to a different target fps (50 -> 25 halves it)", () => {
    const tc: SourceTimecode = { frame: 744, quanta: 50, dropFrame: false };
    expect(timecodeFrames(tc, 25)).toBe(372);
  });

  it("rounds to the nearest frame, half away from zero", () => {
    // 1/3 * 10 = 3.333 -> 3; 2/3 * 10 = 6.666 -> 7.
    expect(timecodeFrames({ frame: 1, quanta: 3, dropFrame: false }, 10)).toBe(3);
    expect(timecodeFrames({ frame: 2, quanta: 3, dropFrame: false }, 10)).toBe(7);
  });

  it("does not consult dropFrame — it is a pure rate conversion", () => {
    const withDrop: SourceTimecode = { frame: 100, quanta: 30, dropFrame: true };
    const withoutDrop: SourceTimecode = { frame: 100, quanta: 30, dropFrame: false };
    expect(timecodeFrames(withDrop, 30)).toBe(timecodeFrames(withoutDrop, 30));
  });

  it("guards against a non-positive quanta", () => {
    expect(timecodeFrames({ frame: 100, quanta: 0, dropFrame: false }, 30)).toBe(0);
  });
});

describe("roundHalfAwayFromZero", () => {
  it("rounds .5 up for positive values", () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
  });

  it("rounds .5 away from zero for negative values (differs from Math.round)", () => {
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2); // documents the JS default we're deliberately avoiding
  });
});
