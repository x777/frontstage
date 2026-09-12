import { describe, expect, test } from "vitest";
import {
  EditorStore,
  applyRemoveAllDeadAir,
  applyRemoveDeadAirForClips,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  parseSilenceRemovalSettings,
  removableMask,
  type Clip,
  type Timeline,
  type Track,
} from "../src/index.js";

function clip(over: Partial<Clip> & { id: string; mediaType: Clip["mediaType"] }): Clip {
  return {
    mediaRef: "m1",
    sourceClipType: over.mediaType,
    startFrame: 0,
    durationFrames: 80,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    ...over,
  };
}

function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

describe("applyRemoveSilence", () => {
  test("one undo restores linked A/V after a dead-air ripple", () => {
    const settings = parseSilenceRemovalSettings(0.5, 0)!;
    // 80 cells @ 0.1s, fps 10 → 1 frame per cell. Quiet non-speech in the middle 20 cells (2s).
    const quiet = [
      ...Array(20).fill(false),
      ...Array(20).fill(true),
      ...Array(40).fill(false),
    ];
    const rem = removableMask(quiet, settings, 0.1);
    expect(rem.includes(true)).toBe(true);

    const tl: Timeline = {
      ...defaultTimeline(),
      fps: 10,
      tracks: [
        track("v", "video", [clip({ id: "v1", mediaType: "video", linkGroupId: "g" })]),
        track("a", "audio", [clip({ id: "a1", mediaType: "audio", linkGroupId: "g" })]),
      ],
    };
    const store = new EditorStore(tl);
    const before = store.getSnapshot().timeline;

    store.dispatch({
      label: "Remove Silence",
      apply: (t) => {
        const out = applyRemoveAllDeadAir(t, settings, () => rem, 0.1);
        return out?.timeline ?? t;
      },
    });

    const after = store.getSnapshot().timeline;
    const audio = after.tracks[1]!.clips;
    const video = after.tracks[0]!.clips;
    const audioDur = audio.reduce((s, c) => s + c.durationFrames, 0);
    const videoDur = video.reduce((s, c) => s + c.durationFrames, 0);
    expect(audioDur).toBeLessThan(80);
    expect(videoDur).toBe(audioDur);

    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips.map((c) => c.durationFrames)).toEqual(
      before.tracks[0]!.clips.map((c) => c.durationFrames),
    );
    expect(store.getSnapshot().timeline.tracks[1]!.clips.map((c) => c.durationFrames)).toEqual(
      before.tracks[1]!.clips.map((c) => c.durationFrames),
    );
  });

  test("scoped clipIds cuts the same linked pair", () => {
    const settings = parseSilenceRemovalSettings(0.5, 0)!;
    const quiet = [...Array(20).fill(false), ...Array(20).fill(true), ...Array(40).fill(false)];
    const rem = removableMask(quiet, settings, 0.1);
    const tl: Timeline = {
      ...defaultTimeline(),
      fps: 10,
      tracks: [
        track("v", "video", [clip({ id: "v1", mediaType: "video", linkGroupId: "g" })]),
        track("a", "audio", [clip({ id: "a1", mediaType: "audio", linkGroupId: "g" })]),
      ],
    };
    const out = applyRemoveDeadAirForClips(tl, ["v1", "a1"], settings, () => rem, 0.1);
    expect(out).not.toBeNull();
    expect(out!.sections).toBeGreaterThan(0);
    const audioDur = out!.timeline.tracks[1]!.clips.reduce((s, c) => s + c.durationFrames, 0);
    const videoDur = out!.timeline.tracks[0]!.clips.reduce((s, c) => s + c.durationFrames, 0);
    expect(audioDur).toBeLessThan(80);
    expect(videoDur).toBe(audioDur);
  });
});
