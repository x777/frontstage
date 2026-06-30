import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { planRippleInsertPreview } from "./ripple-insert-preview.js";
import type { DropPlan } from "./drop-routing.js";

function clip(id: string, startFrame: number, durationFrames: number): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0, speed: 1, volume: 1,
    fadeInFrames: 0, fadeOutFrames: 0, fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}
function track(id: string, clips: Clip[], over: Partial<Track> = {}): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips, ...over };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

describe("planRippleInsertPreview", () => {
  it("opens a gap on the visual target track and shifts the clips after atFrame", () => {
    const tl = timeline([track("t", [clip("a", 0, 30), clip("b", 30, 30)])]);
    const plan: DropPlan = { visualTarget: { kind: "existing", index: 0 }, audioTarget: null, visualDurationFrames: 20, audioOnlyDurationFrames: 0 };
    const out = planRippleInsertPreview(tl, plan, 30)!;
    expect(out.gapRangesByTrackIndex.get(0)).toEqual({ start: 30, end: 50 }); // 20-frame gap at atFrame 30
    expect(out.shiftDeltasByClipId.get("b")).toBe(20); // b pushed right by 20
    expect(out.shiftDeltasByClipId.has("a")).toBe(false); // a is before atFrame
  });

  it("also pushes sync-locked tracks", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 60)]),
      track("audio", [clip("x", 40, 10)], { type: "audio", syncLocked: true }),
    ]);
    const plan: DropPlan = { visualTarget: { kind: "existing", index: 0 }, audioTarget: null, visualDurationFrames: 20, audioOnlyDurationFrames: 0 };
    const out = planRippleInsertPreview(tl, plan, 30)!;
    expect(out.shiftDeltasByClipId.get("x")).toBe(20); // sync-locked follower pushed
  });

  it("records a new-track gap when the visual target is a new track", () => {
    const tl = timeline([track("t", [clip("a", 0, 30)])]);
    const plan: DropPlan = { visualTarget: { kind: "new", index: 0 }, audioTarget: null, visualDurationFrames: 25, audioOnlyDurationFrames: 0 };
    const out = planRippleInsertPreview(tl, plan, 10)!;
    expect(out.newTrackGapRangesByTarget.get("new:0")).toEqual({ start: 10, end: 35 });
  });

  it("returns null when nothing is affected", () => {
    const tl = timeline([track("t", [])]);
    const plan: DropPlan = { visualTarget: null, audioTarget: null, visualDurationFrames: 0, audioOnlyDurationFrames: 0 };
    expect(planRippleInsertPreview(tl, plan, 0)).toBeNull();
  });

  it("maps a post-visual-insert audio target back to the current track and pushes it", () => {
    // timeline: video V0 (a@0,60), audio A1 (x@40,10). firstAudioIndex=1.
    const tl = timeline([
      track("v", [clip("a", 0, 60)]),
      track("audio", [clip("x", 40, 10)], { type: "audio" }),
    ]);
    // visual inserts a NEW track at index 0; audioTarget is ALREADY shifted to existing index 2 (post-insert space).
    const plan: DropPlan = {
      visualTarget: { kind: "new", index: 0 },
      audioTarget: { kind: "existing", index: 2 },
      visualDurationFrames: 20,
      audioOnlyDurationFrames: 15,
    };
    const out = planRippleInsertPreview(tl, plan, 30)!;
    expect(out.newTrackGapRangesByTarget.get("new:0")).toEqual({ start: 30, end: 50 }); // visual new-track gap
    // currentTrackIndex maps existing:2 -> current track 1; x@40 (>=30) pushed by 15
    expect(out.shiftDeltasByClipId.get("x")).toBe(15);
    expect(out.gapRangesByTrackIndex.get(1)).toEqual({ start: 30, end: 45 });
  });
});
