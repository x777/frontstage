import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type MediaManifest,
  type Track,
  type Timeline,
} from "@palmier/core";
import {
  ToolExecutor,
  getTimelineTool,
  getMediaTool,
  type ToolContext,
} from "../src/index.js";

function makeClip(id: string, mediaRef: string, startFrame: number) {
  return {
    id,
    mediaRef,
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame,
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

function makeTimeline(): Timeline {
  const clip1 = makeClip("clip-a", "media-1", 0);
  const clip2 = makeClip("clip-b", "media-2", 30);
  const track: Track = {
    id: "track-1",
    type: "video",
    muted: false,
    hidden: false,
    syncLocked: false,
    clips: [clip1, clip2],
  };
  return { ...defaultTimeline(), tracks: [track] };
}

function makeManifest(): MediaManifest {
  return {
    version: 2,
    entries: [
      {
        id: "media-1",
        name: "sunrise.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/sunrise.mp4" },
        duration: 10,
      },
      {
        id: "media-2",
        name: "ocean.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/ocean.mp4" },
        duration: 15,
      },
    ],
    folders: [],
  };
}

function makeCtx(): ToolContext {
  const manifest = makeManifest();
  const store = new EditorStore(makeTimeline());
  return {
    store,
    getManifest: () => manifest,
    newId: () => "test-id",
  };
}

describe("get_timeline tool", () => {
  test("result is not an error", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    expect(result.isError).toBe(false);
  });

  test("result contains clip ids", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("clip-a");
    expect(text).toContain("clip-b");
  });

  test("result contains media names from manifest", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("sunrise.mp4");
    expect(text).toContain("ocean.mp4");
  });

  test("result contains fps and dimensions", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("30");   // fps
    expect(text).toContain("1920"); // width
    expect(text).toContain("1080"); // height
  });
});

describe("get_media tool", () => {
  test("result is not an error", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getMediaTool()], ctx);
    const result = await ex.execute("get_media", {});
    expect(result.isError).toBe(false);
  });

  test("result contains entry names", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getMediaTool()], ctx);
    const result = await ex.execute("get_media", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("sunrise.mp4");
    expect(text).toContain("ocean.mp4");
  });

  test("result contains entry ids", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getMediaTool()], ctx);
    const result = await ex.execute("get_media", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("media-1");
    expect(text).toContain("media-2");
  });
});
