import { describe, it, expect } from "vitest";
import { moveDelta, trimLeftDelta, trimRightDelta } from "./drag-math.js";
import type { SnapResult } from "./snap.js";

const snap = (frame: number, probeOffset = 0): SnapResult => ({
  frame,
  probeOffset,
  x: frame * 10,
  didSnap: true,
});

describe("moveDelta", () => {
  it("without snap: delta = cursorFrame - grabOffset - originalFrame", () => {
    const d = moveDelta({ cursorFrame: 15, grabOffsetFrames: 5, originalFrame: 10, minOriginalFrame: 0, snap: null });
    // candidate = 15-5 = 10; delta = 10-10 = 0
    expect(d).toBe(0);
  });

  it("without snap: positive movement", () => {
    const d = moveDelta({ cursorFrame: 20, grabOffsetFrames: 5, originalFrame: 10, minOriginalFrame: 0, snap: null });
    // candidate = 15; delta = 15-10 = 5
    expect(d).toBe(5);
  });

  it("clamps to 0 when movement would go before timeline start", () => {
    // originalFrame=5, minOriginalFrame=5, moving left
    const d = moveDelta({ cursorFrame: 0, grabOffsetFrames: 0, originalFrame: 5, minOriginalFrame: 5, snap: null });
    // candidate=0; delta=0-5=-5; clamp max(-5, delta)=-5 -> result = max(-5, -5) = -5
    // But minOriginalFrame=5 means we can go back at most 5 frames (delta >= -5)
    expect(d).toBe(-5);
  });

  it("clamps to zero when deltaFrames would push before frame 0 for multi-clip", () => {
    // clip at frame 2, delta=-3 => would go to -1; clamp by -minOriginalFrame=-2
    const d = moveDelta({ cursorFrame: 0, grabOffsetFrames: 0, originalFrame: 5, minOriginalFrame: 2, snap: null });
    // candidate=0; delta=0-5=-5; max(-2, -5) = -2
    expect(d).toBe(-2);
  });

  it("with snap: uses snap.frame - snap.probeOffset - originalFrame", () => {
    // snap.frame=20, probeOffset=5, originalFrame=10 => delta = 20-5-10 = 5
    const d = moveDelta({ cursorFrame: 99, grabOffsetFrames: 0, originalFrame: 10, minOriginalFrame: 0, snap: snap(20, 5) });
    expect(d).toBe(5);
  });

  it("with snap: clamps to -minOriginalFrame", () => {
    // snap.frame=0, probeOffset=0, originalFrame=5 => delta=-5; minOriginalFrame=3 => max(-3,-5)=-3
    const d = moveDelta({ cursorFrame: 0, grabOffsetFrames: 0, originalFrame: 5, minOriginalFrame: 3, snap: snap(0, 0) });
    expect(d).toBe(-3);
  });
});

describe("trimLeftDelta", () => {
  it("basic positive delta (trimming inward from left)", () => {
    const d = trimLeftDelta({ snappedStartFrame: 15, originalStartFrame: 10, originalDuration: 20, originalTrimStart: 5, hasNoSourceMedia: false });
    // delta=5; maxDelta=19; minDelta=-5; clamp(5,-5,19)=5
    expect(d).toBe(5);
  });

  it("clamps at maxDelta (can't shrink to 0 frames)", () => {
    const d = trimLeftDelta({ snappedStartFrame: 100, originalStartFrame: 10, originalDuration: 20, originalTrimStart: 5, hasNoSourceMedia: false });
    // delta=90; maxDelta=19; clamp(90,-5,19)=19
    expect(d).toBe(19);
  });

  it("clamps minDelta at -originalTrimStart for sourced clip", () => {
    const d = trimLeftDelta({ snappedStartFrame: 0, originalStartFrame: 10, originalDuration: 20, originalTrimStart: 5, hasNoSourceMedia: false });
    // delta=-10; minDelta=-5; clamp(-10,-5,19)=-5
    expect(d).toBe(-5);
  });

  it("clamps minDelta at -originalStartFrame for image/text (hasNoSourceMedia)", () => {
    const d = trimLeftDelta({ snappedStartFrame: 0, originalStartFrame: 10, originalDuration: 20, originalTrimStart: 5, hasNoSourceMedia: true });
    // delta=-10; minDelta=-10 (=-originalStartFrame); clamp(-10,-10,19)=-10
    expect(d).toBe(-10);
  });

  it("image clip at frame 0 cannot go further left", () => {
    const d = trimLeftDelta({ snappedStartFrame: -5, originalStartFrame: 0, originalDuration: 10, originalTrimStart: 0, hasNoSourceMedia: true });
    // delta=-5; minDelta=0 (=-0); clamp(-5,0,9)=0
    expect(d).toBe(0);
  });
});

describe("trimRightDelta", () => {
  it("basic positive delta (trimming outward to right)", () => {
    // originalEnd=30, snappedEnd=35 => delta=5; maxDelta=originalTrimEnd=10 for sourced
    const d = trimRightDelta({ snappedEndFrame: 35, originalStartFrame: 10, originalDuration: 20, originalTrimEnd: 10, hasNoSourceMedia: false });
    expect(d).toBe(5);
  });

  it("clamps minDelta to -(originalDuration-1)", () => {
    // originalEnd=30, snappedEnd=11 => delta=-19; minDelta=-(20-1)=-19 => clamp(-19,-19,10)=-19
    const d = trimRightDelta({ snappedEndFrame: 11, originalStartFrame: 10, originalDuration: 20, originalTrimEnd: 10, hasNoSourceMedia: false });
    expect(d).toBe(-19);
  });

  it("clamps past minDelta", () => {
    // snappedEnd=10 => delta=-20; minDelta=-19 => clamp(-20,-19,10)=-19
    const d = trimRightDelta({ snappedEndFrame: 10, originalStartFrame: 10, originalDuration: 20, originalTrimEnd: 10, hasNoSourceMedia: false });
    expect(d).toBe(-19);
  });

  it("clamps maxDelta at originalTrimEnd for sourced clip", () => {
    // delta=50; maxDelta=10 => clamp(50,-19,10)=10
    const d = trimRightDelta({ snappedEndFrame: 80, originalStartFrame: 10, originalDuration: 20, originalTrimEnd: 10, hasNoSourceMedia: false });
    expect(d).toBe(10);
  });

  it("allows unlimited expansion for image/text (hasNoSourceMedia)", () => {
    // delta=1000; maxDelta=Infinity => clamp(1000,-19,Infinity)=1000
    const d = trimRightDelta({ snappedEndFrame: 1030, originalStartFrame: 10, originalDuration: 20, originalTrimEnd: 0, hasNoSourceMedia: true });
    expect(d).toBe(1000);
  });

  it("speed=2 sourced clip: originalTrimEnd limits expansion (trim math is speed-agnostic in delta)", () => {
    // For a speed=2 clip, the caller computes the right trimEnd; the function just clamps to originalTrimEnd
    const d = trimRightDelta({ snappedEndFrame: 35, originalStartFrame: 10, originalDuration: 20, originalTrimEnd: 3, hasNoSourceMedia: false });
    // delta=5; maxDelta=3 => clamp(5,-19,3)=3
    expect(d).toBe(3);
  });
});
