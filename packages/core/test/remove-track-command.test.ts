import { describe, it, expect } from "vitest";
import { EditorStore, defaultTimeline } from "../src/index.js";
import { removeTrackCommand } from "../src/editor/timeline-commands.js";
import type { Track, Timeline } from "../src/timeline.js";
import type { Clip } from "../src/clip.js";

function makeClip(id: string): Clip {
  return {
    id,
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 30,
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
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  };
}

function makeTrack(id: string): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip(`c-${id}`)] };
}

function timelineWithTracks(...ids: string[]): Timeline {
  return { ...defaultTimeline(), tracks: ids.map(makeTrack) };
}

describe("removeTrackCommand", () => {
  it("removes a track by id", () => {
    const tl = timelineWithTracks("t1", "t2");
    const result = removeTrackCommand("t1").apply(tl);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]!.id).toBe("t2");
  });

  it("removes the correct track by id when multiple tracks exist", () => {
    const tl = timelineWithTracks("t1", "t2", "t3");
    const result = removeTrackCommand("t2").apply(tl);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("is a no-op (same ref) when track id is absent", () => {
    const tl = timelineWithTracks("t1");
    const result = removeTrackCommand("nonexistent").apply(tl);
    expect(result).toBe(tl);
  });

  it("label is Remove Track", () => {
    expect(removeTrackCommand("t1").label).toBe("Remove Track");
  });

  it("is undoable via EditorStore", () => {
    const tl = timelineWithTracks("t1", "t2");
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    store.dispatch(removeTrackCommand("t1"));
    expect(store.getSnapshot().timeline.tracks).toHaveLength(1);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
    expect(store.canRedo()).toBe(true);
  });

  it("no-op command does not push to undo stack", () => {
    const tl = timelineWithTracks("t1");
    const store = new EditorStore(tl);
    store.dispatch(removeTrackCommand("missing"));
    expect(store.canUndo()).toBe(false);
  });
});
