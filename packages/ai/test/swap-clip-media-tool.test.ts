import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  findClip,
  type Clip,
  type MediaManifest,
  type Timeline,
} from "@frontstage/core";
import { swapClipMediaTool, type ToolContext } from "../src/index.js";

function makeClip(id: string, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: "old-media",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame: 12,
    durationFrames: 30,
    trimStartFrame: 10,
    trimEndFrame: 20,
    speed: 1.5,
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

function manifest(): MediaManifest {
  return {
    version: 2,
    entries: [
      { id: "old-media", name: "old.mp4", type: "video", source: { kind: "external", absolutePath: "/old.mp4" }, duration: 3, hasAudio: true },
      { id: "new-media", name: "new.mp4", type: "video", source: { kind: "external", absolutePath: "/new.mp4" }, duration: 4, hasAudio: true },
      { id: "short-media", name: "short.mp4", type: "video", source: { kind: "external", absolutePath: "/short.mp4" }, duration: 1, hasAudio: true },
      { id: "silent-media", name: "silent.mp4", type: "video", source: { kind: "external", absolutePath: "/silent.mp4" }, duration: 4 },
      { id: "image-media", name: "still.png", type: "image", source: { kind: "external", absolutePath: "/still.png" }, duration: 0 },
    ],
    folders: [],
  };
}

function makeCtx(store: EditorStore): ToolContext {
  return { store, getManifest: manifest, newId: () => "x" };
}

function json(result: { blocks: { kind: string; text?: string }[] }) {
  return JSON.parse(result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("")) as Record<string, unknown>;
}

function clip(store: EditorStore, id: string) {
  const tl = store.getSnapshot().timeline;
  const loc = findClip(tl, id)!;
  return tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
}

describe("swap_clip_media", () => {
  test("swaps linked A/V sharing the source and keeps transform/keyframes", async () => {
    const video = makeClip("video-clip", {
      linkGroupId: "linked",
      transform: { ...defaultTransform(), centerX: 0.4, width: 0.7 },
      opacityTrack: { keyframes: [{ frame: 5, value: 0.8, interpolationOut: "smooth" }] },
    });
    const audio = makeClip("audio-clip", {
      mediaType: "audio",
      sourceClipType: "video",
      linkGroupId: "linked",
      volume: 0.25,
    });
    const store = new EditorStore({
      ...defaultTimeline(),
      fps: 30,
      tracks: [
        { id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [video] },
        { id: "a", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [audio] },
      ],
    } satisfies Timeline);

    for (const mediaRef of ["short-media", "silent-media", "image-media"]) {
      const refused = await swapClipMediaTool().run({ clipId: "video-clip", mediaRef }, makeCtx(store));
      expect(refused.isError).toBe(true);
    }
    expect(clip(store, "video-clip").mediaRef).toBe("old-media");
    expect(store.canUndo()).toBe(false);

    const swapped = await swapClipMediaTool().run({ clipId: "video-clip", mediaRef: "new-media" }, makeCtx(store));
    expect(swapped.isError).toBe(false);
    const body = json(swapped);
    expect(body.changed).toBe(true);
    expect(new Set(body.affectedClipIds as string[])).toEqual(new Set(["audio-clip", "video-clip"]));
    expect(clip(store, "video-clip").mediaRef).toBe("new-media");
    expect(clip(store, "audio-clip").mediaRef).toBe("new-media");
    expect(clip(store, "video-clip").trimEndFrame).toBe(65);
    expect(clip(store, "audio-clip").trimEndFrame).toBe(65);
    expect(clip(store, "video-clip").transform.centerX).toBe(0.4);
    expect(clip(store, "video-clip").opacityTrack).toEqual(video.opacityTrack);
    expect(clip(store, "audio-clip").volume).toBe(0.25);

    const noOp = await swapClipMediaTool().run({ clipId: "video-clip", mediaRef: "new-media" }, makeCtx(store));
    expect(json(noOp).changed).toBe(false);

    store.undo();
    expect(clip(store, "video-clip").mediaRef).toBe("old-media");
    expect(clip(store, "audio-clip").trimEndFrame).toBe(20);
  });

  test("refuses text and nested sequence clips", async () => {
    const store = new EditorStore({
      ...defaultTimeline(),
      tracks: [
        {
          id: "v",
          type: "video",
          muted: false,
          hidden: false,
          syncLocked: false,
          clips: [
            makeClip("text", { mediaType: "text", sourceClipType: "text", mediaRef: "title" }),
            makeClip("nest", { sourceClipType: "sequence", mediaRef: "child" }),
          ],
        },
      ],
    });
    expect((await swapClipMediaTool().run({ clipId: "text", mediaRef: "new-media" }, makeCtx(store))).isError).toBe(true);
    expect((await swapClipMediaTool().run({ clipId: "nest", mediaRef: "new-media" }, makeCtx(store))).isError).toBe(true);
  });
});
