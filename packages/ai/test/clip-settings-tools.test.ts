import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  findClip,
  type Timeline,
  type Track,
} from "@frontstage/core";
import { copyClipSettingsTool, type ToolContext } from "../src/index.js";

function makeClip(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    mediaRef: "media-1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame: 0,
    durationFrames: 60,
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
    ...extra,
  };
}

function makeCtx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => "x",
  };
}

function json(result: { blocks: { kind: string; text?: string }[] }) {
  return JSON.parse(result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("")) as Record<string, unknown>;
}

function clip(store: EditorStore, id: string) {
  const tl = store.getSnapshot().timeline;
  const loc = findClip(tl, id)!;
  return tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
}

describe("copy_clip_settings", () => {
  test("copies opacity/transform to an explicit same-type target in one undo", async () => {
    const source = makeClip("s", { opacity: 0.4, transform: { ...defaultTransform(), centerX: 0.2 } });
    const target = makeClip("t", { startFrame: 90, opacity: 1 });
    const track: Track = { id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [source, target] };
    const store = new EditorStore({ ...defaultTimeline(), tracks: [track] } satisfies Timeline);
    const result = await copyClipSettingsTool().run({ sourceClipId: "s", targetClipIds: ["t"] }, makeCtx(store));
    expect(result.isError).toBe(false);
    const body = json(result);
    expect(body.changed).toBe(true);
    expect(body.changedClipIds).toEqual(["t"]);
    expect(clip(store, "t").opacity).toBe(0.4);
    expect(clip(store, "t").transform.centerX).toBe(0.2);
    expect(clip(store, "t").startFrame).toBe(90);
    store.undo();
    expect(clip(store, "t").opacity).toBe(1);
  });

  test("refuses a mismatched media type on targetClipIds", async () => {
    const store = new EditorStore({
      ...defaultTimeline(),
      tracks: [
        { id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("s")] },
        {
          id: "a",
          type: "audio",
          muted: false,
          hidden: false,
          syncLocked: false,
          clips: [makeClip("a1", { mediaType: "audio", sourceClipType: "audio" })],
        },
      ],
    });
    const before = store.getSnapshot().timeline;
    const result = await copyClipSettingsTool().run({ sourceClipId: "s", targetClipIds: ["a1"] }, makeCtx(store));
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
  });

  test("targetTrack skips the source and mismatched clips and returns counts", async () => {
    const source = makeClip("s", { opacity: 0.3, startFrame: 0 });
    const same = makeClip("v2", { opacity: 1, startFrame: 70 });
    const other = makeClip("txt", { mediaType: "text", sourceClipType: "text", startFrame: 140 });
    const store = new EditorStore({
      ...defaultTimeline(),
      tracks: [{ id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [source, same, other] }],
    });
    const result = await copyClipSettingsTool().run(
      { sourceClipId: "s", targetTrack: { trackId: "v" } },
      makeCtx(store),
    );
    expect(result.isError).toBe(false);
    const body = json(result);
    expect(body.matchedClipCount).toBe(1);
    expect(body.changedClipCount).toBe(1);
    expect(body.incompatibleClipCount).toBe(1);
    expect(body.sourceExcluded).toBe(true);
    expect(clip(store, "v2").opacity).toBe(0.3);
    expect(clip(store, "s").id).toBe("s");
  });

  test("requires exactly one target mode", async () => {
    const store = new EditorStore({
      ...defaultTimeline(),
      tracks: [{ id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("s")] }],
    });
    const both = await copyClipSettingsTool().run(
      { sourceClipId: "s", targetClipIds: ["s"], targetTrack: { trackId: "v" } },
      makeCtx(store),
    );
    expect(both.isError).toBe(true);
    const neither = await copyClipSettingsTool().run({ sourceClipId: "s" }, makeCtx(store));
    expect(neither.isError).toBe(true);
  });
});
