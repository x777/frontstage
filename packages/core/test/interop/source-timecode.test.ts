import { describe, it, expect } from "vitest";
import { timecodeFrames, roundHalfAwayFromZero, parseTimecodeTag, type SourceTimecode } from "../../src/interop/source-timecode.js";

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

describe("parseTimecodeTag", () => {
  it("parses a non-drop-frame tag at an integer fps", () => {
    expect(parseTimecodeTag("01:00:00:00", 30)).toEqual({ frame: 108000, quanta: 30, dropFrame: false });
  });

  it("parses a non-drop tag mid-second", () => {
    // 1h2m3s4f @30fps = ((3723)*30)+4
    expect(parseTimecodeTag("01:02:03:04", 30)).toEqual({ frame: 111694, quanta: 30, dropFrame: false });
  });

  it("rounds 23.976 to quanta 24 (non-drop, NTSC film rate)", () => {
    const tc = parseTimecodeTag("00:00:10:05", 23.976);
    expect(tc).toEqual({ frame: 245, quanta: 24, dropFrame: false });
  });

  it("rounds 29.97 to quanta 30 and treats ';' as drop-frame", () => {
    const tc = parseTimecodeTag("00:00:10;05", 29.97);
    expect(tc?.quanta).toBe(30);
    expect(tc?.dropFrame).toBe(true);
  });

  it("drop-frame: exactly 1 hour is 107892 frames (the well-known drop-frame identity)", () => {
    expect(parseTimecodeTag("01:00:00;00", 29.97)).toEqual({ frame: 107892, quanta: 30, dropFrame: true });
  });

  it("drop-frame: 9 non-exempt minutes have elapsed by the 10-minute mark (18 frames dropped)", () => {
    // 10 min @ 30fps nominal = 18000 frames, minus 2*9 dropped minutes (1..9; minute 0 and 10 are exempt)
    expect(parseTimecodeTag("00:10:00;00", 29.97)).toEqual({ frame: 17982, quanta: 30, dropFrame: true });
  });

  it("drop-frame: the first valid label after minute 1's skip (;00,;01 skipped) reflects the drop", () => {
    // 1 min @ 30fps nominal = 1800 + 2 (the label itself is ;02) - 2 dropped = 1800
    expect(parseTimecodeTag("00:01:00;02", 29.97)).toEqual({ frame: 1800, quanta: 30, dropFrame: true });
  });

  it("accepts ':' as the frame separator even when hh/mm/ss use it too (non-drop)", () => {
    expect(parseTimecodeTag("00:00:01:00", 25)).toEqual({ frame: 25, quanta: 25, dropFrame: false });
  });

  it("rejects malformed tags", () => {
    expect(parseTimecodeTag("", 30)).toBeNull();
    expect(parseTimecodeTag("not a timecode", 30)).toBeNull();
    expect(parseTimecodeTag("00:00:00", 30)).toBeNull();
    expect(parseTimecodeTag("00:00:00:00:00", 30)).toBeNull();
    expect(parseTimecodeTag("aa:bb:cc:dd", 30)).toBeNull();
  });

  it("rejects out-of-range fields", () => {
    expect(parseTimecodeTag("00:60:00:00", 30)).toBeNull(); // minutes
    expect(parseTimecodeTag("00:00:60:00", 30)).toBeNull(); // seconds
    expect(parseTimecodeTag("00:00:00:30", 30)).toBeNull(); // frames >= quanta
  });

  it("rejects a non-positive fps", () => {
    expect(parseTimecodeTag("00:00:00:00", 0)).toBeNull();
    expect(parseTimecodeTag("00:00:00:00", -5)).toBeNull();
  });
});
