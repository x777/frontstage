import { describe, it, expect } from "vitest";
import {
  collectTargets,
  findSnap,
  newSnapState,
  SNAP_BASE_PX,
  SNAP_STICKY_MULT,
  SNAP_PLAYHEAD_MULT,
} from "./snap.js";
import type { Track } from "../timeline.js";
import type { Clip } from "../clip.js";

function makeClip(id: string, startFrame: number, durationFrames: number): Clip {
  return {
    id,
    mediaRef: "m1",
    mediaType: "video",
    sourceClipType: "video",
    startFrame,
    durationFrames,
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
  };
}

function makeTrack(id: string, clips: Clip[]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

describe("constants", () => {
  it("SNAP_BASE_PX=8", () => expect(SNAP_BASE_PX).toBe(8));
  it("SNAP_STICKY_MULT=1.5", () => expect(SNAP_STICKY_MULT).toBe(1.5));
  it("SNAP_PLAYHEAD_MULT=1.5", () => expect(SNAP_PLAYHEAD_MULT).toBe(1.5));
});

describe("collectTargets", () => {
  it("includes clip start and end edges", () => {
    const track = makeTrack("t1", [makeClip("c1", 10, 20)]);
    const targets = collectTargets([track]);
    expect(targets).toContainEqual({ frame: 10, kind: "clipEdge" });
    expect(targets).toContainEqual({ frame: 30, kind: "clipEdge" }); // 10+20
  });

  it("excludes clips in excludeClipIds", () => {
    const track = makeTrack("t1", [makeClip("c1", 10, 20), makeClip("c2", 50, 10)]);
    const targets = collectTargets([track], { excludeClipIds: new Set(["c1"]) });
    expect(targets.every((t) => t.frame !== 10 && t.frame !== 30)).toBe(true);
    expect(targets).toContainEqual({ frame: 50, kind: "clipEdge" });
    expect(targets).toContainEqual({ frame: 60, kind: "clipEdge" });
  });

  it("includes playhead when includePlayhead=true", () => {
    const targets = collectTargets([], { playheadFrame: 42, includePlayhead: true });
    expect(targets).toContainEqual({ frame: 42, kind: "playhead" });
  });

  it("does not include playhead when includePlayhead=false (default)", () => {
    const targets = collectTargets([], { playheadFrame: 42 });
    expect(targets.some((t) => t.kind === "playhead")).toBe(false);
  });

  it("handles multiple tracks", () => {
    const tracks = [
      makeTrack("t1", [makeClip("c1", 0, 10)]),
      makeTrack("t2", [makeClip("c2", 20, 5)]),
    ];
    const targets = collectTargets(tracks);
    expect(targets).toContainEqual({ frame: 0, kind: "clipEdge" });
    expect(targets).toContainEqual({ frame: 10, kind: "clipEdge" });
    expect(targets).toContainEqual({ frame: 20, kind: "clipEdge" });
    expect(targets).toContainEqual({ frame: 25, kind: "clipEdge" });
  });
});

describe("findSnap", () => {
  const ppf = 10; // 10px per frame => baseFrameThreshold = 8/10 = 0.8 frames

  it("snaps within threshold", () => {
    const state = newSnapState();
    const targets = [{ frame: 10, kind: "clipEdge" as const }];
    // position=10 => dist=0, within threshold
    const result = findSnap({ position: 10, targets, state, baseThresholdPx: SNAP_BASE_PX, pixelsPerFrame: ppf });
    expect(result).not.toBeNull();
    expect(result!.frame).toBe(10);
    expect(result!.didSnap).toBe(true);
    expect(result!.x).toBe(10 * ppf); // content space: frame*pixelsPerFrame
  });

  it("returns null past threshold", () => {
    const state = newSnapState();
    const targets = [{ frame: 10, kind: "clipEdge" as const }];
    // baseFrameThreshold = 8/10 = 0.8; position=12 => dist=2 > 0.8
    const result = findSnap({ position: 12, targets, state, baseThresholdPx: SNAP_BASE_PX, pixelsPerFrame: ppf });
    expect(result).toBeNull();
  });

  it("sticky: holds snap within stickyMult * threshold then releases", () => {
    const state = newSnapState();
    const targets = [{ frame: 10, kind: "clipEdge" as const }];
    // First snap at frame 10
    const r1 = findSnap({ position: 10, targets, state, baseThresholdPx: SNAP_BASE_PX, pixelsPerFrame: ppf });
    expect(r1).not.toBeNull();
    expect(state.currentlySnappedTo).toBe(10);

    // Move to position=11 (dist=1 > 0.8 threshold but <= 1.2 stickyThreshold) => still snapped
    const r2 = findSnap({ position: 11, targets, state, baseThresholdPx: SNAP_BASE_PX, pixelsPerFrame: ppf });
    expect(r2).not.toBeNull();
    expect(r2!.frame).toBe(10);

    // Move to position=12 => dist=2 > 1.2 stickyThreshold => released
    const r3 = findSnap({ position: 12, targets, state, baseThresholdPx: SNAP_BASE_PX, pixelsPerFrame: ppf });
    expect(r3).toBeNull();
    expect(state.currentlySnappedTo).toBeNull();
  });

  it("playhead beats clipEdge at equal distance (larger multiplier)", () => {
    // Use ppf=1 so baseFrameThreshold = 8.
    // Put clipEdge at frame 7 (dist=7 from pos=0) and playhead at frame 8 (dist=8).
    // clipEdge threshold = 8, playhead threshold = 12.
    // Both are within their thresholds. The closest is clipEdge at dist=7.
    // So to test playhead priority by multiplier, we need a case where BOTH are at the same distance
    // but playhead is preferred. Looking at the Swift code: it's NOT priority by kind — it's purely
    // by distance. Playhead wins at equal or smaller distance due to its larger threshold allowing
    // snaps the clipEdge threshold wouldn't. Let's test a case where only playhead is within range:
    const state = newSnapState();
    const targets = [
      { frame: 100, kind: "clipEdge" as const }, // dist=9 from pos=91, threshold=8 => out
      { frame: 100, kind: "playhead" as const },  // dist=9 from pos=91, threshold=12 => in
    ];
    const result = findSnap({ position: 91, targets, state, baseThresholdPx: SNAP_BASE_PX, pixelsPerFrame: 1 });
    expect(result).not.toBeNull();
    expect(result!.frame).toBe(100);
  });

  it("probe offset: end edge snaps via probeOffsets", () => {
    const state = newSnapState();
    // position = clip start = 0, duration = 10 => end probe at 10
    // target at frame 10 (another clip's start)
    const targets = [{ frame: 10, kind: "clipEdge" as const }];
    const result = findSnap({
      position: 0,
      probeOffsets: [0, 10],
      targets,
      state,
      baseThresholdPx: SNAP_BASE_PX,
      pixelsPerFrame: ppf,
    });
    expect(result).not.toBeNull();
    expect(result!.frame).toBe(10);
    expect(result!.probeOffset).toBe(10); // the end probe snapped
  });

  it("newSnapState returns idle state", () => {
    const s = newSnapState();
    expect(s.currentlySnappedTo).toBeNull();
    expect(s.currentProbeOffset).toBe(0);
  });
});
