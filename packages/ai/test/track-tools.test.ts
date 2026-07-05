import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type Timeline,
  type Track,
} from "@frontstage/core";
import { removeTracksTool, type ToolContext } from "../src/index.js";

function makeClip(id: string) {
  return {
    id,
    mediaRef: "m",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame: 0,
    durationFrames: 30,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear" as const,
    fadeOutInterpolation: "linear" as const,
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
  };
}

function makeTrack(id: string): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip(`c-${id}`)] };
}

function makeTimeline(...trackIds: string[]): Timeline {
  return { ...defaultTimeline(), tracks: trackIds.map(makeTrack) };
}

let _counter = 0;
function makeCtx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => `g-${++_counter}`,
  };
}

describe("remove_tracks", () => {
  test("removes a single track by id", async () => {
    const store = new EditorStore(makeTimeline("t1", "t2"));
    const ctx = makeCtx(store);
    const result = await removeTracksTool().run({ trackIds: ["t1"] }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks).toHaveLength(1);
    expect(tl.tracks[0]!.id).toBe("t2");
  });

  test("removes multiple tracks in one call", async () => {
    const store = new EditorStore(makeTimeline("t1", "t2", "t3"));
    const ctx = makeCtx(store);
    const result = await removeTracksTool().run({ trackIds: ["t1", "t3"] }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks).toHaveLength(1);
    expect(tl.tracks[0]!.id).toBe("t2");
  });

  test("removal is ONE undo step", async () => {
    const store = new EditorStore(makeTimeline("t1", "t2"));
    const ctx = makeCtx(store);
    await removeTracksTool().run({ trackIds: ["t1", "t2"] }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks).toHaveLength(2);
    expect(store.canUndo()).toBe(false);
  });

  test("unknown trackId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline("t1"));
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await removeTracksTool().run({ trackIds: ["nonexistent"] }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("partial bad trackId: all-or-nothing, store unchanged", async () => {
    const store = new EditorStore(makeTimeline("t1", "t2"));
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await removeTracksTool().run({ trackIds: ["t1", "nonexistent"] }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});
