import { describe, it, expect } from "vitest";
import type { Timeline, Track } from "../timeline.js";
import { resolveVisualDropTarget, resolveAudioDropTarget, preferredAudioTrack, shiftAfterVisualInsertion, resolveDropPlan } from "./drop-routing.js";

function track(id: string, type: Track["type"]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips: [] };
}
function timeline(types: Track["type"][]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks: types.map((t, i) => track(`${t}${i}`, t)) };
}

describe("resolveVisualDropTarget", () => {
  it("keeps a cursor already on a video track", () => {
    const tl = timeline(["video", "video", "audio"]); // firstAudioIndex 2
    expect(resolveVisualDropTarget(tl, { kind: "existing", index: 0 })).toEqual({ kind: "existing", index: 0 });
  });
  it("mirrors an audio-track cursor across the divider (A1 -> V1)", () => {
    const tl = timeline(["video", "video", "audio", "audio"]); // firstAudioIndex 2
    // cursor A1 = index 2 -> distance 0 -> mirrored = firstAudioIndex-1-0 = 1 (V2/bottom video)
    expect(resolveVisualDropTarget(tl, { kind: "existing", index: 2 })).toEqual({ kind: "existing", index: 1 });
  });
  it("empty timeline -> new track at 0", () => {
    expect(resolveVisualDropTarget(timeline([]), { kind: "existing", index: 0 })).toEqual({ kind: "new", index: 0 });
  });
});

describe("preferredAudioTrack / resolveAudioDropTarget", () => {
  it("mirrors a video-track cursor to its paired audio track (V1 -> A1)", () => {
    const tl = timeline(["video", "video", "audio", "audio"]); // firstAudioIndex 2
    // cursor V1 = index 1 (bottom video) -> distanceFromDivider = firstAudioIndex-1-1 = 0 -> A1 = firstAudioIndex+0 = 2
    expect(preferredAudioTrack(tl, { kind: "existing", index: 1 })).toBe(2);
    expect(resolveAudioDropTarget(tl, { kind: "existing", index: 1 })).toEqual({ kind: "existing", index: 2 });
  });
  it("no audio tracks -> new track at end", () => {
    const tl = timeline(["video"]);
    expect(resolveAudioDropTarget(tl, { kind: "existing", index: 0 })).toEqual({ kind: "new", index: 1 });
  });
});

describe("shiftAfterVisualInsertion", () => {
  it("bumps an audio target index when the visual insert lands before it", () => {
    expect(shiftAfterVisualInsertion({ kind: "existing", index: 2 }, { kind: "new", index: 1 })).toEqual({ kind: "existing", index: 3 });
    expect(shiftAfterVisualInsertion({ kind: "existing", index: 0 }, { kind: "new", index: 1 })).toEqual({ kind: "existing", index: 0 });
    expect(shiftAfterVisualInsertion({ kind: "existing", index: 2 }, { kind: "existing", index: 0 })).toEqual({ kind: "existing", index: 2 }); // no shift unless visual is a new-track
  });
});

describe("resolveDropPlan", () => {
  it("video-with-audio drop yields both a visual and a mirrored audio target", () => {
    const tl = timeline(["video", "video", "audio", "audio"]);
    const plan = resolveDropPlan(tl, { kind: "existing", index: 1 }, "video", true, 30);
    expect(plan.visualTarget).toEqual({ kind: "existing", index: 1 });
    expect(plan.audioTarget).toEqual({ kind: "existing", index: 2 });
    expect(plan.visualDurationFrames).toBe(30);
    expect(plan.audioOnlyDurationFrames).toBe(30);
  });
  it("video-no-audio drop has no audio target", () => {
    const tl = timeline(["video"]);
    const plan = resolveDropPlan(tl, { kind: "existing", index: 0 }, "video", false, 30);
    expect(plan.audioTarget).toBeNull();
    expect(plan.audioOnlyDurationFrames).toBe(0);
  });
  it("audio-only drop has no visual target", () => {
    const tl = timeline(["video", "audio"]);
    const plan = resolveDropPlan(tl, { kind: "existing", index: 1 }, "audio", false, 30);
    expect(plan.visualTarget).toBeNull();
    expect(plan.visualDurationFrames).toBe(0);
    expect(plan.audioTarget).toEqual({ kind: "existing", index: 1 });
  });
});
