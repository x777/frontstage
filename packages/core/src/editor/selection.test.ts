import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { selectForward, forwardSelectionAnchorId, hitTestGap } from "./selection.js";

function clip(id: string, startFrame: number, durationFrames: number, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 }, ...over,
  };
}
function track(id: string, clips: Clip[], type: Track["type"] = "video"): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

describe("selectForward", () => {
  const tl = timeline([
    track("t1", [clip("a", 0, 10), clip("b", 50, 10), clip("c", 100, 10)]),
    track("t2", [clip("d", 60, 10)]),
  ]);
  it("selects clips at/after the anchor on its own track in 'track' scope", () => {
    expect([...selectForward(tl, "b", "track")].sort()).toEqual(["b", "c"]);
  });
  it("selects clips at/after the anchor start across all tracks in 'allTracks' scope", () => {
    // anchor b starts at 50; c(100) and d(60) qualify, a(0) does not
    expect([...selectForward(tl, "b", "allTracks")].sort()).toEqual(["b", "c", "d"]);
  });
  it("expands the result to link groups", () => {
    const linked = timeline([
      track("v", [clip("x", 0, 10, { linkGroupId: "g" })]),
      track("a", [clip("y", 0, 10, { linkGroupId: "g" })], "audio"),
    ]);
    expect([...selectForward(linked, "x", "track")].sort()).toEqual(["x", "y"]);
  });
  it("returns an empty set for an unknown anchor", () => {
    expect([...selectForward(tl, "missing", "track")]).toEqual([]);
  });
});

describe("forwardSelectionAnchorId", () => {
  const tl = timeline([
    track("t1", [clip("a", 30, 10), clip("b", 10, 10)]),
    track("t2", [clip("c", 10, 10)]),
  ]);
  it("picks the leftmost selected clip, breaking ties by lower track index", () => {
    // b(10,t1) and c(10,t2) tie on startFrame -> t1 wins
    expect(forwardSelectionAnchorId(tl, new Set(["a", "b", "c"]))).toBe("b");
  });
  it("returns null when nothing is selected", () => {
    expect(forwardSelectionAnchorId(tl, new Set())).toBeNull();
  });
});

describe("hitTestGap", () => {
  const tl = timeline([track("t", [clip("a", 0, 10), clip("b", 40, 10)])]);
  it("returns the gap bounded by the previous clip end and the next clip start", () => {
    expect(hitTestGap(tl, 0, 20)).toEqual({ trackIndex: 0, range: { start: 10, end: 40 } });
  });
  it("returns null when the frame is inside a clip", () => {
    expect(hitTestGap(tl, 0, 5)).toBeNull();
  });
  it("returns null when no clip follows the frame", () => {
    expect(hitTestGap(tl, 0, 60)).toBeNull();
  });
  it("uses 0 as the previous end when the frame is before the first clip", () => {
    const t2 = timeline([track("t", [clip("a", 30, 10)])]);
    expect(hitTestGap(t2, 0, 10)).toEqual({ trackIndex: 0, range: { start: 0, end: 30 } });
  });
});
