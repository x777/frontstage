import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type Timeline,
  type Track,
} from "@frontstage/core";
import { manageTracksTool, removeTracksTool, type ToolContext } from "../src/index.js";

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

function json(result: { blocks: { kind: string; text?: string }[] }) {
  const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("manage_tracks", () => {
  test("names a track and returns V1/A1 labels separately", async () => {
    const store = new EditorStore(makeTimeline("t1", "t2"));
    const ctx = makeCtx(store);
    const result = await manageTracksTool().run({ set: [{ trackId: "t1", name: "Dialogue" }] }, ctx);
    expect(result.isError).toBe(false);
    expect(store.getSnapshot().timeline.tracks[0]!.name).toBe("Dialogue");
    const body = json(result);
    expect((body.tracks as { label: string }[])[0]!.label).toBe("V2");
    expect((body.renamed as { name: string }[])[0]!.name).toBe("Dialogue");
  });

  test("empty name clears the user-authored name", async () => {
    const store = new EditorStore(makeTimeline("t1"));
    const ctx = makeCtx(store);
    await manageTracksTool().run({ set: [{ trackId: "t1", name: "Main" }] }, ctx);
    const result = await manageTracksTool().run({ set: [{ trackId: "t1", name: "" }] }, ctx);
    expect(result.isError).toBe(false);
    expect(store.getSnapshot().timeline.tracks[0]!.name).toBeUndefined();
  });

  test("rejects a newline in the name", async () => {
    const store = new EditorStore(makeTimeline("t1"));
    const before = store.getSnapshot().timeline;
    const result = await manageTracksTool().run({ set: [{ trackId: "t1", name: "Main\nVideo" }] }, makeCtx(store));
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
  });

  test("reorders within the same type zone and refuses a cross-type destination", async () => {
    const store = new EditorStore({
      ...defaultTimeline(),
      tracks: [
        makeTrack("v0"),
        makeTrack("v1"),
        { id: "a0", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [] },
      ],
    });
    const ctx = makeCtx(store);
    const bad = await manageTracksTool().run({ reorder: [{ trackId: "v0", to: 2 }] }, ctx);
    expect(bad.isError).toBe(true);
    const okResult = await manageTracksTool().run({ reorder: [{ trackId: "v1", to: 0 }] }, ctx);
    expect(okResult.isError).toBe(false);
    expect(store.getSnapshot().timeline.tracks.map((t) => t.id)).toEqual(["v1", "v0", "a0"]);
  });

  test("set + remove is one undo step", async () => {
    const store = new EditorStore(makeTimeline("t1", "t2", "t3"));
    const ctx = makeCtx(store);
    const result = await manageTracksTool().run(
      { set: [{ trackId: "t2", muted: true }], remove: [{ trackId: "t1" }] },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(store.getSnapshot().timeline.tracks.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(store.getSnapshot().timeline.tracks[0]!.muted).toBe(true);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(store.canUndo()).toBe(false);
  });

  test("nothing to do errors without touching the store", async () => {
    const store = new EditorStore(makeTimeline("t1"));
    const before = store.getSnapshot().timeline;
    const result = await manageTracksTool().run({}, makeCtx(store));
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
  });
});
