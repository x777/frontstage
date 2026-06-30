import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { clearRegion, validateShiftsForTrack, rippleDeleteSelectedClips, rippleDeleteRangesOnTrack, rippleDeleteRanges, rippleDeleteGap } from "./ripple-commands.js";

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

describe("rippleDeleteRangesOnTrack", () => {
  it("clears a mid-clip range and ripples the tail left, returning a report", () => {
    const tl = timeline([track("t", [clip("a", 0, 100)])]); // remove [40,60)
    const out = rippleDeleteRangesOnTrack(tl, 0, [{ start: 40, end: 60 }]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.report.removedFrames).toBe(20);
    expect(out.report.anchorTrackIndex).toBe(0);
    // a split into [0,40) + a tail that shifted left by 20 to start at 40
    const fragments = out.report.resultingFragments;
    expect(fragments.length).toBe(2);
    expect(fragments[0]!.startFrame).toBe(0);
    expect(fragments[1]!.startFrame).toBe(40);
  });

  it("follows a linked partner onto its track and clears+shifts it too", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 100, { linkGroupId: "g" })]),
      track("a", [clip("b", 0, 100, { linkGroupId: "g" })], { type: "audio" }),
    ]);
    const out = rippleDeleteRangesOnTrack(tl, 0, [{ start: 40, end: 60 }]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.report.clearedTracks).toBe(2); // anchor + linked audio
    // both tracks have a [0,40) head and a tail starting at 40
    expect(out.timeline.tracks[1]!.clips.map((c) => c.startFrame).sort((x, y) => x - y)).toEqual([0, 40]);
  });

  it("refuses when a non-ignored sync-locked track would collide", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 100)]),
      track("a", [clip("x", 0, 50), clip("y", 70, 10)], { type: "audio", syncLocked: true }),
    ]);
    // clearing [40,60) on v shifts y (70) left 20 -> 50, which touches x end (50) — adjacent is OK,
    // so use a bigger removal to force overlap:
    const out = rippleDeleteRangesOnTrack(tl, 0, [{ start: 30, end: 70 }]); // 40 removed -> y 70->30 overlaps x [0,50)
    expect(out.kind).toBe("refused");
  });

  it("ignoreSyncLockTrackIndices skips that track entirely", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 100)]),
      track("a", [clip("x", 0, 50), clip("y", 70, 10)], { type: "audio", syncLocked: true }),
    ]);
    const out = rippleDeleteRangesOnTrack(tl, 0, [{ start: 30, end: 70 }], new Set([1]));
    expect(out.kind).toBe("ok"); // track 1 ignored -> no refusal, and it is not shifted
    if (out.kind !== "ok") return;
    expect(out.timeline.tracks[1]!.clips.map((c) => c.startFrame)).toEqual([0, 70]); // unchanged
  });
});

describe("rippleDeleteRanges", () => {
  it("resolves the anchor clip's track", () => {
    const tl = timeline([track("t1", []), track("t2", [clip("a", 0, 100)])]);
    const out = rippleDeleteRanges(tl, "a", [{ start: 40, end: 60 }]);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") expect(out.report.anchorTrackIndex).toBe(1);
  });
  it("refuses for an unknown anchor clip", () => {
    const tl = timeline([track("t", [clip("a", 0, 100)])]);
    expect(rippleDeleteRanges(tl, "missing", [{ start: 0, end: 10 }]).kind).toBe("refused");
  });
});

describe("rippleDeleteGap", () => {
  it("closes an empty gap on its track", () => {
    // clip a [0,10), gap [10,30), clip b [30,10)
    const tl = timeline([track("t", [clip("a", 0, 10), clip("b", 30, 10)])]);
    const out = rippleDeleteGap(tl, { trackIndex: 0, range: { start: 10, end: 30 } });
    expect("timeline" in out).toBe(true);
    const clips = (out as { timeline: Timeline }).timeline.tracks[0]!.clips;
    expect(clips.find((c) => c.id === "b")!.startFrame).toBe(10); // b 30 -> 10
  });

  it("returns { stale: true } when a clip now overlaps the gap", () => {
    const tl = timeline([track("t", [clip("a", 0, 40)])]); // a covers [0,40)
    const out = rippleDeleteGap(tl, { trackIndex: 0, range: { start: 10, end: 30 } });
    expect(out).toEqual({ stale: true });
  });

  it("refuses when a sync-locked follower would collide", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 10), clip("b", 30, 10)]),
      track("audio", [clip("x", 0, 25), clip("y", 30, 10)], { type: "audio", syncLocked: true }),
    ]);
    // closing gap [10,30) shifts y (30) left 20 -> 10, overlapping x [0,25) -> refuse
    expect("refused" in rippleDeleteGap(tl, { trackIndex: 0, range: { start: 10, end: 30 } })).toBe(true);
  });
});

import { trimValues, rippleTrimDurationDelta, syncLockedLeftRoom } from "./ripple-commands.js";

describe("trimValues", () => {
  it("right-edge growth consumes tail source, clamped at 0 for sourced clips", () => {
    const c = clip("a", 0, 30, { trimStartFrame: 0, trimEndFrame: 5, speed: 1 });
    // grow right by +5 -> newEnd = 5 - 5 = 0
    expect(trimValues(c, "right", 5)).toEqual({ trimStart: 0, trimEnd: 0 });
    // grow right by +10 -> newEnd = 5 - 10 = -5 -> clamp 0 (no more source)
    expect(trimValues(c, "right", 10)).toEqual({ trimStart: 0, trimEnd: 0 });
  });
  it("left-edge trim advances source start; image is unbounded", () => {
    const v = clip("v", 10, 30, { trimStartFrame: 0, mediaType: "video" });
    expect(trimValues(v, "left", 5).trimStart).toBe(5); // 0 + round(5*1)
    const v2 = clip("v", 10, 30, { trimStartFrame: 0, mediaType: "video" });
    expect(trimValues(v2, "left", -3).trimStart).toBe(0); // -3 clamped to 0
    const img = clip("i", 10, 30, { trimStartFrame: 0, mediaType: "image" });
    expect(trimValues(img, "left", -3).trimStart).toBe(-3); // unbounded
  });
});

describe("rippleTrimDurationDelta", () => {
  it("returns the realised timeline-duration delta after the source clamp", () => {
    const c = clip("a", 0, 30, { trimStartFrame: 0, trimEndFrame: 5, speed: 1 });
    expect(rippleTrimDurationDelta(c, "right", 5)).toBe(5);  // full +5 available
    expect(rippleTrimDurationDelta(c, "right", 10)).toBe(5); // clamped to the 5 frames of tail source
  });
});

describe("syncLockedLeftRoom", () => {
  it("room is the gap between the previous clip end and the first clip at/after insertFrame", () => {
    const t = track("t", [clip("a", 0, 20), clip("b", 50, 10)]);
    expect(syncLockedLeftRoom(t, 50)).toEqual({ room: 30, obstacle: 20 }); // b at 50, prev end 20
  });
  it("returns null when no clip is at/after insertFrame", () => {
    const t = track("t", [clip("a", 0, 20)]);
    expect(syncLockedLeftRoom(t, 50)).toBeNull();
  });
});

import { planRippleTrim, rippleTrimClip } from "./ripple-commands.js";

describe("planRippleTrim + rippleTrimClip", () => {
  it("right-trim shrinks the clip and ripples later clips left", () => {
    // a [0,30) trimStart 0 trimEnd 10 (10 frames of tail source), b [30,10)
    const tl = timeline([track("t", [clip("a", 0, 30, { trimEndFrame: 10 }), clip("b", 30, 10)])]);
    const next = rippleTrimClip(tl, "a", "right", -10, false); // shrink right by 10
    const a = next.tracks[0]!.clips.find((c) => c.id === "a")!;
    const b = next.tracks[0]!.clips.find((c) => c.id === "b")!;
    expect(a.durationFrames).toBe(20); // 30 - 10
    expect(b.startFrame).toBe(20);     // rippled left by 10
  });

  it("clamps a shrink to a sync-locked follower's available room", () => {
    // a's right edge (insertFrame) is 30; follower has x [0,10) and y [40,10).
    const tl = timeline([
      track("v", [clip("a", 0, 30, { trimEndFrame: 30 })]),
      track("audio", [clip("x", 0, 10), clip("y", 40, 10)], { type: "audio", syncLocked: true }),
    ]);
    const plan = planRippleTrim(tl, "a", "right", -100, false); // try to shrink by 100
    expect(plan).not.toBeNull();
    // follower room at insertFrame 30: first clip >= 30 is y(40), prevEnd = x end 10 -> room 30
    expect(plan!.durationDelta).toBe(-30); // clamped to -room
    expect(plan!.blockedAtFrame).toBe(10);
  });

  it("returns the timeline unchanged for a zero delta", () => {
    const tl = timeline([track("t", [clip("a", 0, 30)])]);
    expect(rippleTrimClip(tl, "a", "right", 0, false)).toBe(tl);
  });
});
