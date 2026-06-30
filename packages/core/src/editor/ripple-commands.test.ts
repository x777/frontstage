import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { clearRegion, validateShiftsForTrack } from "./ripple-commands.js";

export function clip(id: string, startFrame: number, durationFrames: number, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 }, ...over,
  };
}
export function track(id: string, clips: Clip[], over: Partial<Track> = {}): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips, ...over };
}
export function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

describe("clearRegion", () => {
  it("removes a clip fully inside the region", () => {
    const tl = timeline([track("t", [clip("a", 10, 10)])]); // [10,20) inside [0,40)
    const next = clearRegion(tl, 0, 0, 40);
    expect(next.tracks[0]!.clips).toHaveLength(0);
  });
  it("trims a clip overlapping the region head", () => {
    const tl = timeline([track("t", [clip("a", 0, 30)])]); // [0,30); clear [0,10)
    const v = clearRegion(tl, 0, 0, 10).tracks[0]!.clips[0]!;
    expect(v.startFrame).toBeGreaterThanOrEqual(10);
  });
});

describe("validateShiftsForTrack", () => {
  it("returns null for a valid shift and a message (with track id) for a collision", () => {
    const t = track("vt", [clip("a", 0, 20), clip("b", 100, 10)]);
    expect(validateShiftsForTrack(t, [{ clipId: "b", newStartFrame: 50 }])).toBeNull();
    const err = validateShiftsForTrack(t, [{ clipId: "b", newStartFrame: 10 }]); // overlaps a
    expect(err).toContain("vt");
  });
});

import { rippleDeleteSelectedClips } from "./ripple-commands.js";

describe("rippleDeleteSelectedClips", () => {
  it("removes a selected clip and ripples later clips left on its track", () => {
    const tl = timeline([track("t", [clip("a", 0, 40), clip("b", 40, 10)])]);
    const out = rippleDeleteSelectedClips(tl, new Set(["a"]));
    expect("timeline" in out).toBe(true);
    const clips = (out as { timeline: Timeline }).timeline.tracks[0]!.clips;
    expect(clips.map((c) => c.id)).toEqual(["b"]);
    expect(clips[0]!.startFrame).toBe(0); // b shifted from 40 -> 0 (closed the 40-frame gap)
  });

  it("shifts a sync-locked follower track by the removed gap", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 40), clip("keep", 40, 10)]),
      track("a", [clip("x", 60, 10)], { type: "audio", syncLocked: true }),
    ]);
    const out = rippleDeleteSelectedClips(tl, new Set(["a"])) as { timeline: Timeline };
    // audio clip x (start 60) is after the removed range [0,40) -> shifts left 40 -> 20
    expect(out.timeline.tracks[1]!.clips[0]!.startFrame).toBe(20);
  });

  it("refuses when a sync-locked follower would collide", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 40), clip("keep", 40, 10)]),
      track("a", [clip("x", 0, 30), clip("y", 60, 10)], { type: "audio", syncLocked: true }),
    ]);
    // shifting y left 40 -> 20 would overlap x ([0,30)) -> refuse
    const out = rippleDeleteSelectedClips(tl, new Set(["a"]));
    expect("refused" in out).toBe(true);
  });

  it("no-op (same timeline) for an empty selection", () => {
    const tl = timeline([track("t", [clip("a", 0, 10)])]);
    expect((rippleDeleteSelectedClips(tl, new Set()) as { timeline: Timeline }).timeline).toBe(tl);
  });
});
