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

// --- New symbols: INSERT_THRESHOLD, TrackDropTarget, dropTargetAt, insertionLineY, ghostY ---

import {
  INSERT_THRESHOLD,
  dropTargetAt,
  insertionLineY,
  ghostY,
} from "./geometry.js";

describe("INSERT_THRESHOLD", () => {
  it("is 10", () => expect(INSERT_THRESHOLD).toBe(10));
});

describe("makeGeometry with dropZoneHeight", () => {
  it("dropZoneHeight=0 by default keeps first track top = rulerHeight", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50] });
    expect(g.dropZoneHeight).toBe(0);
    expect(g.cumulativeY[0]).toBe(24); // RULER_HEIGHT + 0
  });

  it("dropZoneHeight shifts first track top", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 60], dropZoneHeight: 30 });
    expect(g.dropZoneHeight).toBe(30);
    expect(g.cumulativeY[0]).toBe(24 + 30); // RULER_HEIGHT + dropZoneHeight
    expect(g.cumulativeY[1]).toBe(24 + 30 + 50);
  });
});

describe("dropTargetAt — no tracks", () => {
  it("returns new@0 when there are no tracks", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [] });
    expect(dropTargetAt(g, 100)).toEqual({ kind: "new", index: 0 });
  });
});

describe("dropTargetAt — top zone", () => {
  it("y above first track → new@0", () => {
    // rulerHeight=24, first track top=24; y=10 < 24
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    expect(dropTargetAt(g, 10)).toEqual({ kind: "new", index: 0 });
  });

  it("y exactly at first track top is NOT in top zone", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // cumulativeY[0]=24; y=24 => NOT < 24 => falls through to other logic
    // track 0: [24, 74), so y=24 hits within it
    const result = dropTargetAt(g, 24);
    // Should be existing track 0 or near-boundary — at exactly y=24 it's within track 0
    expect(result).toEqual({ kind: "existing", index: 0 });
  });
});

describe("dropTargetAt — between tracks (threshold)", () => {
  // Two tracks: track0=[24,74), track1=[74,124). No gap between them.
  // bottomOfTrack0=74, topOfNext=74
  // boundary region: [74-10, 74+10] = [64, 84]
  it("y near bottom of track 0 within threshold → new@1", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // bottomOfTrack0 = 24 + 50 = 74; y >= 74-10=64
    expect(dropTargetAt(g, 65)).toEqual({ kind: "new", index: 1 });
  });

  it("y near top of track 1 within threshold → new@1", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // topOfNext = 74; y <= 74+10=84
    expect(dropTargetAt(g, 83)).toEqual({ kind: "new", index: 1 });
  });

  it("y in middle of track 0 (not near boundary) → existing@0", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // Track 0: [24,74). Middle ~50. bottomOfTrack0-threshold=64 → y=40 not in boundary
    expect(dropTargetAt(g, 40)).toEqual({ kind: "existing", index: 0 });
  });

  it("y in middle of track 1 → existing@1", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // Track 1: [74,124). Middle ~99. Not near any boundary with threshold 10
    expect(dropTargetAt(g, 99)).toEqual({ kind: "existing", index: 1 });
  });
});

describe("dropTargetAt — below last track", () => {
  it("y past last track bottom → new@trackCount", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // lastTrackBottom = 74 + 50 = 124; y >= 124 → new@2
    expect(dropTargetAt(g, 124)).toEqual({ kind: "new", index: 2 });
    expect(dropTargetAt(g, 200)).toEqual({ kind: "new", index: 2 });
  });

  it("single track: y past bottom → new@1", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50] });
    // track0=[24,74); lastBottom=74
    expect(dropTargetAt(g, 74)).toEqual({ kind: "new", index: 1 });
  });
});

describe("insertionLineY", () => {
  it("returns null for existing target", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    expect(insertionLineY(g, { kind: "existing", index: 0 })).toBeNull();
  });

  it("new@0 with tracks → top of first track", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    expect(insertionLineY(g, { kind: "new", index: 0 })).toBe(24); // cumulativeY[0]
  });

  it("new@1 (between tracks) → top of track 1", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    expect(insertionLineY(g, { kind: "new", index: 1 })).toBe(74); // cumulativeY[1]
  });

  it("new@trackCount → bottom of last track", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // cumulativeY[1] + trackHeights[1] = 74 + 50 = 124
    expect(insertionLineY(g, { kind: "new", index: 2 })).toBe(124);
  });

  it("no tracks: returns rulerHeight + dropZoneHeight", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [], dropZoneHeight: 20 });
    expect(insertionLineY(g, { kind: "new", index: 0 })).toBe(24 + 20);
  });

  it("dropZoneHeight shifts new@0 insertion line", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50], dropZoneHeight: 10 });
    // cumulativeY[0] = 24 + 10 = 34
    expect(insertionLineY(g, { kind: "new", index: 0 })).toBe(34);
  });
});

describe("ghostY", () => {
  it("returns null for existing target", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50] });
    expect(ghostY(g, { kind: "existing", index: 0 })).toBeNull();
  });

  it("new@0 (before first track) → lineY - height (ghost above)", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // lineY = cumulativeY[0] = 24; index 0 < trackCount 2 → lineY - height = 24 - 50 = -26
    expect(ghostY(g, { kind: "new", index: 0 }, 50)).toBe(24 - 50);
  });

  it("new@trackCount (after last track) → lineY (ghost below)", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // lineY=124; index 2 >= trackCount 2 → lineY = 124
    expect(ghostY(g, { kind: "new", index: 2 }, 50)).toBe(124);
  });

  it("new@1 (between tracks) → lineY - height", () => {
    const g = makeGeometry({ pixelsPerFrame: 5, trackHeights: [50, 50] });
    // lineY = cumulativeY[1] = 74; index 1 < trackCount 2 → 74 - 50 = 24
    expect(ghostY(g, { kind: "new", index: 1 }, 50)).toBe(74 - 50);
  });
});
