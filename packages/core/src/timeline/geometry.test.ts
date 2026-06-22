import { describe, it, expect } from "vitest";
import {
  makeGeometry,
  xForFrame,
  frameAtX,
  trackTopY,
  trackHeightAt,
  trackAtY,
  clipRect,
  RULER_HEIGHT,
  DEFAULT_TRACK_HEIGHT,
  TRIM_HANDLE_WIDTH,
} from "./geometry.js";
import type { Clip } from "../clip.js";

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    mediaRef: "m1",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 10,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    ...overrides,
  };
}

describe("constants", () => {
  it("exports RULER_HEIGHT=24", () => expect(RULER_HEIGHT).toBe(24));
  it("exports DEFAULT_TRACK_HEIGHT=50", () => expect(DEFAULT_TRACK_HEIGHT).toBe(50));
  it("exports TRIM_HANDLE_WIDTH=4", () => expect(TRIM_HANDLE_WIDTH).toBe(4));
});

describe("makeGeometry", () => {
  it("precomputes cumulativeY with first track top = rulerHeight (no dropZone gap)", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 60] });
    expect(g.cumulativeY[0]).toBe(24);       // RULER_HEIGHT
    expect(g.cumulativeY[1]).toBe(24 + 50);  // 74
  });

  it("defaults scrollX and headerWidth to 0", () => {
    const g = makeGeometry({ pixelsPerFrame: 2 });
    expect(g.scrollX).toBe(0);
    expect(g.headerWidth).toBe(0);
  });
});

describe("xForFrame / frameAtX round-trip", () => {
  it("basic round-trip with no scrollX or headerWidth", () => {
    const g = makeGeometry({ pixelsPerFrame: 10 });
    const frame = 5;
    const x = xForFrame(g, frame);
    expect(x).toBe(50);
    expect(frameAtX(g, x)).toBe(frame);
  });

  it("round-trip with scrollX", () => {
    const g = makeGeometry({ pixelsPerFrame: 10, scrollX: 30 });
    const frame = 7;
    const x = xForFrame(g, frame);
    expect(x).toBe(70 - 30); // 40
    expect(frameAtX(g, x)).toBe(frame);
  });

  it("round-trip with headerWidth and scrollX", () => {
    const g = makeGeometry({ pixelsPerFrame: 4, headerWidth: 100, scrollX: 20 });
    const frame = 15;
    const x = xForFrame(g, frame);
    // headerWidth + frame*ppf - scrollX = 100 + 60 - 20 = 140
    expect(x).toBe(140);
    expect(frameAtX(g, x)).toBe(frame);
  });

  it("round-trip with zoom (pixelsPerFrame=2)", () => {
    const g = makeGeometry({ pixelsPerFrame: 2, headerWidth: 50, scrollX: 10 });
    const frame = 20;
    const x = xForFrame(g, frame);
    expect(x).toBe(50 + 20 * 2 - 10); // 80
    expect(frameAtX(g, x)).toBe(frame);
  });

  it("frameAtX clamps to 0 for negative frames", () => {
    const g = makeGeometry({ pixelsPerFrame: 10, scrollX: 0 });
    expect(frameAtX(g, -50)).toBe(0);
  });
});

describe("trackAtY banding", () => {
  it("returns 0 for y in first track", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // Track 0: y in [24, 74)
    expect(trackAtY(g, 24)).toBe(0);
    expect(trackAtY(g, 50)).toBe(0);
    expect(trackAtY(g, 73)).toBe(0);
  });

  it("returns 1 for y in second track", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // Track 1: y in [74, 124)
    expect(trackAtY(g, 74)).toBe(1);
    expect(trackAtY(g, 100)).toBe(1);
    expect(trackAtY(g, 123)).toBe(1);
  });

  it("clamps to last track for y beyond all tracks", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    expect(trackAtY(g, 999)).toBe(1);
  });

  it("returns 0 for single track", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50] });
    expect(trackAtY(g, 24)).toBe(0);
    expect(trackAtY(g, 9999)).toBe(0);
  });
});

describe("clipRect", () => {
  it("computes correct x and width", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50] });
    const clip = makeClip({ startFrame: 10, durationFrames: 20 });
    const r = clipRect(g, clip, 0);
    // x = xForFrame(g, 10) = 10 * 5 = 50
    expect(r.x).toBe(50);
    // width = 20 * 5 = 100
    expect(r.width).toBe(100);
  });

  it("insets y by 2 and height by 4", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50] });
    const clip = makeClip({ startFrame: 0, durationFrames: 1 });
    const r = clipRect(g, clip, 0);
    // trackTop = 24, y = 24 + 2 = 26, height = 50 - 4 = 46
    expect(r.y).toBe(26);
    expect(r.height).toBe(46);
  });

  it("accounts for scrollX in x", () => {
    const g = makeGeometry({ pixelsPerFrame: 10, scrollX: 50, trackHeights: [50] });
    const clip = makeClip({ startFrame: 10, durationFrames: 5 });
    const r = clipRect(g, clip, 0);
    // x = headerWidth + 10*10 - 50 = 0 + 100 - 50 = 50
    expect(r.x).toBe(50);
  });

  it("uses trackHeights for second track", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 60] });
    const clip = makeClip({ startFrame: 0, durationFrames: 1 });
    const r = clipRect(g, clip, 1);
    // trackTop for index 1 = 24 + 50 = 74
    expect(r.y).toBe(74 + 2);
    expect(r.height).toBe(60 - 4);
  });
});
