import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { makeGeometry } from "./geometry.js";
import { rectsIntersect, marqueeSelect, timelineRangeEdgeHit, rangeEdgeAnchorFrame, RANGE_EDGE_SLOP } from "./gesture-hit.js";

function clip(id: string, startFrame: number, durationFrames: number, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0, speed: 1, volume: 1,
    fadeInFrames: 0, fadeOutFrames: 0, fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 }, ...over,
  };
}
function track(id: string, clips: Clip[], type: Track["type"] = "video"): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

describe("rectsIntersect", () => {
  it("detects overlap and rejects disjoint rects", () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 })).toBe(false);
  });
});

describe("marqueeSelect", () => {
  // pixelsPerFrame 1; two video tracks height 50 each (default).
  const g = makeGeometry({ pixelsPerFrame: 1, trackHeights: [50, 50] });
  const tl = timeline([
    track("t1", [clip("a", 0, 20), clip("b", 100, 20)]),
    track("t2", [clip("c", 0, 20, { linkGroupId: "g" })], "audio"),
  ]);

  it("selects clips whose rect intersects the marquee, unioned onto the base selection", () => {
    // rect over frames [0,30) on track 0's row only -> clip a (not b at 100, not c on track 1's row)
    const r = marqueeSelect(tl, g, { x: 0, y: 0, width: 30, height: 50 }, new Set(["z"]), false);
    expect([...r].sort()).toEqual(["a", "z"]); // base "z" preserved
  });

  it("expands the marquee result to link groups when requested", () => {
    const linked = timeline([
      track("v", [clip("x", 0, 20, { linkGroupId: "p" })]),
      track("a", [clip("y", 0, 20, { linkGroupId: "p" })], "audio"),
    ]);
    const g2 = makeGeometry({ pixelsPerFrame: 1, trackHeights: [50, 50] });
    // rect over only the top (video) row, frames [0,30) -> hits x; expand -> x + y
    const r = marqueeSelect(linked, g2, { x: 0, y: 0, width: 30, height: 50 }, new Set(), true);
    expect([...r].sort()).toEqual(["x", "y"]);
  });
});

describe("timelineRangeEdgeHit", () => {
  const g = makeGeometry({ pixelsPerFrame: 1 });
  const range = { startFrame: 100, endFrame: 200 };
  it("returns the nearest edge within slop, tie to start", () => {
    expect(timelineRangeEdgeHit(g, 102, range)).toBe("start"); // near start (x=100)
    expect(timelineRangeEdgeHit(g, 198, range)).toBe("end");   // near end (x=200)
    expect(timelineRangeEdgeHit(g, 150, range)).toBeNull();    // mid, beyond slop
  });
  it("uses the slop boundary (8px default)", () => {
    expect(timelineRangeEdgeHit(g, 100 + RANGE_EDGE_SLOP, range)).toBe("start");
    expect(timelineRangeEdgeHit(g, 100 + RANGE_EDGE_SLOP + 1, range)).toBeNull();
  });
});

describe("rangeEdgeAnchorFrame", () => {
  it("returns the opposite edge as the drag anchor", () => {
    const range = { startFrame: 100, endFrame: 200 };
    expect(rangeEdgeAnchorFrame(range, "start")).toBe(200);
    expect(rangeEdgeAnchorFrame(range, "end")).toBe(100);
  });
});
