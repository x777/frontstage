import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import { defaultTimeline } from "../src/timeline.js";
import type { Track } from "../src/timeline.js";
import { EditorStore, removeClipCommand, setClipPropertyCommand } from "../src/index.js";

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
    transform: defaultTransform(),
    crop: defaultCrop(),
  };
}

function makeTrack(clips: Clip[]): Track {
  return { id: "t1", type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function timelineWithOneClip(clipId: string) {
  return { ...defaultTimeline(), tracks: [makeTrack([makeClip(clipId)])] };
}

describe("commands", () => {
  test("dispatch applies a command and undo restores the prior timeline", () => {
    const store = new EditorStore(timelineWithOneClip("c1"));
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(1);
    store.dispatch(removeClipCommand("c1"));
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(0);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(1);
    expect(store.canRedo()).toBe(true);
    store.redo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(0);
  });

  test("a new dispatch clears the redo stack", () => {
    const store = new EditorStore(timelineWithOneClip("c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.5));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.8));
    expect(store.canRedo()).toBe(false);
  });

  test("same coalesceKey merges into one undo entry", () => {
    const store = new EditorStore(timelineWithOneClip("c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.5, "vol-c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.2, "vol-c1"));
    store.undo(); // one undo reverts BOTH (to the original volume)
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(1);
  });

  test("removeClipCommand is a no-op if clip not found", () => {
    const store = new EditorStore(timelineWithOneClip("c1"));
    const before = store.getSnapshot().timeline;
    store.dispatch(removeClipCommand("nonexistent"));
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("setClipPropertyCommand is a no-op if clip not found", () => {
    const store = new EditorStore(timelineWithOneClip("c1"));
    const before = store.getSnapshot().timeline;
    store.dispatch(setClipPropertyCommand("nonexistent", "volume", 0.5));
    expect(store.getSnapshot().timeline).toBe(before);
  });

  test("setClipPropertyCommand updates the correct clip property", () => {
    const store = new EditorStore(timelineWithOneClip("c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.75));
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(0.75);
  });

  test("different coalesceKeys each push to undo stack", () => {
    const store = new EditorStore(timelineWithOneClip("c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.5, "vol-c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.2, "vol-c2"));
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(0.5);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(1);
  });
});
