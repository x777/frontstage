import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, type Track, type Timeline, type MediaManifest } from "@palmier/core";
import { inspectTimelineTool, buildCatalog, ToolExecutor, type ToolContext } from "../src/index.js";

function makeClip(id: string, durationFrames: number) {
  return {
    id,
    mediaRef: "media-1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame: 0,
    durationFrames,
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

function makeTrack(durationFrames: number): Track {
  return { id: "t1", type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("c1", durationFrames)] };
}

// totalFrames-many-frame timeline at the default 1920x1080/30fps; 0 -> empty timeline (no tracks).
function makeTimeline(totalFrames: number): Timeline {
  return { ...defaultTimeline(), tracks: totalFrames > 0 ? [makeTrack(totalFrames)] : [] };
}

function makeManifest(): MediaManifest {
  return {
    version: 2,
    entries: [{ id: "media-1", name: "clip.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/clip.mp4" }, duration: 2 }],
    folders: [],
  };
}

let _n = 0;
function makeCtx(store: EditorStore, renderFrame?: ToolContext["renderFrame"]): ToolContext {
  return { store, getManifest: makeManifest, newId: () => `gen-${++_n}`, renderFrame };
}

// Every rendered frame "succeeds" with a base64 tag identifying the frame, so assertions can
// confirm which frames were actually rendered (not just how many).
const okRenderFrame: NonNullable<ToolContext["renderFrame"]> = async (atFrame) => ({
  rgba: new Uint8Array(4),
  width: 4,
  height: 4,
  jpegBase64: `jpeg-${atFrame}`,
});

function textBlockPayload(blocks: { kind: string; text?: string }[]): Record<string, unknown> {
  const text = blocks.find((b) => b.kind === "text");
  expect(text).toBeDefined();
  return JSON.parse((text as { text: string }).text) as Record<string, unknown>;
}

describe("inspect_timeline — capability", () => {
  test("ctx.renderFrame absent → the inspect_color-style capability error", async () => {
    const store = new EditorStore(makeTimeline(120));
    const ctx = makeCtx(store);
    const result = await inspectTimelineTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "frame rendering is not available in this context" });
  });
});

describe("inspect_timeline — single frame (no endFrame)", () => {
  test("no args → ONE frame at startFrame 0", async () => {
    const store = new EditorStore(makeTimeline(120));
    const ctx = makeCtx(store, okRenderFrame);
    const result = await inspectTimelineTool().run({}, ctx);
    expect(result.isError).toBe(false);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toEqual({ kind: "image", base64: "jpeg-0", mediaType: "image/jpeg" });
    expect(result.blocks[1]!.kind).toBe("text");
    const meta = textBlockPayload(result.blocks);
    expect(meta).toEqual({ fps: 30, width: 512, height: 288, totalFrames: 120, frameNumbers: [0] });
  });

  test("explicit startFrame, no endFrame → ONE frame there, maxFrames ignored", async () => {
    const store = new EditorStore(makeTimeline(120));
    const ctx = makeCtx(store, okRenderFrame);
    const result = await inspectTimelineTool().run({ startFrame: 42, maxFrames: 6 }, ctx);
    expect(result.isError).toBe(false);
    const meta = textBlockPayload(result.blocks);
    expect(meta.frameNumbers).toEqual([42]);
  });
});

describe("inspect_timeline — even sampling arithmetic (pinned to Swift's index math)", () => {
  test("[0, 120) maxFrames 6 → [10, 30, 50, 70, 90, 110]", async () => {
    const store = new EditorStore(makeTimeline(120));
    const ctx = makeCtx(store, okRenderFrame);
    const result = await inspectTimelineTool().run({ endFrame: 120, maxFrames: 6 }, ctx);
    expect(result.isError).toBe(false);
    const meta = textBlockPayload(result.blocks);
    expect(meta.frameNumbers).toEqual([10, 30, 50, 70, 90, 110]);
    // 6 image blocks + 1 trailing text block, images first
    expect(result.blocks).toHaveLength(7);
    for (let i = 0; i < 6; i++) expect(result.blocks[i]!.kind).toBe("image");
    expect(result.blocks[6]!.kind).toBe("text");
  });

  test("a non-zero startFrame offsets every sampled frame", async () => {
    const store = new EditorStore(makeTimeline(220));
    const ctx = makeCtx(store, okRenderFrame);
    const result = await inspectTimelineTool().run({ startFrame: 100, endFrame: 220, maxFrames: 6 }, ctx);
    const meta = textBlockPayload(result.blocks);
    // span=120 same as above, offset by startFrame=100
    expect(meta.frameNumbers).toEqual([110, 130, 150, 170, 190, 210]);
  });

  test("maxFrames omitted with endFrame set → defaults to 6", async () => {
    const store = new EditorStore(makeTimeline(120));
    const ctx = makeCtx(store, okRenderFrame);
    const result = await inspectTimelineTool().run({ endFrame: 120 }, ctx);
    const meta = textBlockPayload(result.blocks);
    expect((meta.frameNumbers as number[]).length).toBe(6);
  });
});

describe("inspect_timeline — the 12-frame cap", () => {
  test("maxFrames 100 over a 1000-frame span → clamped to 12, exact frames", async () => {
    const store = new EditorStore(makeTimeline(1000));
    const ctx = makeCtx(store, okRenderFrame);
    const result = await inspectTimelineTool().run({ endFrame: 1000, maxFrames: 100 }, ctx);
    expect(result.isError).toBe(false);
    const meta = textBlockPayload(result.blocks);
    expect(meta.frameNumbers).toEqual([41, 125, 208, 291, 375, 458, 541, 625, 708, 791, 875, 958]);
  });

  test("span itself under 12 → count never exceeds the span", async () => {
    const store = new EditorStore(makeTimeline(5));
    const ctx = makeCtx(store, okRenderFrame);
    const result = await inspectTimelineTool().run({ endFrame: 5, maxFrames: 12 }, ctx);
    const meta = textBlockPayload(result.blocks);
    expect((meta.frameNumbers as number[]).length).toBe(5);
  });
});

describe("inspect_timeline — per-frame render failure", () => {
  test("a frame that fails to render (throws) is skipped; others still returned", async () => {
    const store = new EditorStore(makeTimeline(120));
    const flaky: NonNullable<ToolContext["renderFrame"]> = async (atFrame) => {
      if (atFrame === 30) throw new Error("seek failed");
      return okRenderFrame(atFrame);
    };
    const ctx = makeCtx(store, flaky);
    const result = await inspectTimelineTool().run({ endFrame: 120, maxFrames: 6 }, ctx);
    expect(result.isError).toBe(false);
    const meta = textBlockPayload(result.blocks);
    expect(meta.frameNumbers).toEqual([10, 50, 70, 90, 110]);
  });

  test("a frame with no jpegBase64 is skipped the same way", async () => {
    const store = new EditorStore(makeTimeline(120));
    const noJpeg: NonNullable<ToolContext["renderFrame"]> = async () => ({ rgba: new Uint8Array(4), width: 4, height: 4 });
    const ctx = makeCtx(store, noJpeg);
    const result = await inspectTimelineTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Failed to render timeline frames." });
  });
});

describe("inspect_timeline — validation matrix, through the ToolExecutor", () => {
  test("negative startFrame → out-of-range error", async () => {
    const store = new EditorStore(makeTimeline(120));
    const executor = new ToolExecutor([inspectTimelineTool()], makeCtx(store, okRenderFrame));
    const result = await executor.execute("inspect_timeline", { startFrame: -5 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "startFrame -5 out of range [0, 120)." });
  });

  test("startFrame >= totalFrames → out-of-range error", async () => {
    const store = new EditorStore(makeTimeline(120));
    const executor = new ToolExecutor([inspectTimelineTool()], makeCtx(store, okRenderFrame));
    const result = await executor.execute("inspect_timeline", { startFrame: 120 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "startFrame 120 out of range [0, 120)." });
  });

  test("endFrame equal to startFrame → error", async () => {
    const store = new EditorStore(makeTimeline(120));
    const executor = new ToolExecutor([inspectTimelineTool()], makeCtx(store, okRenderFrame));
    const result = await executor.execute("inspect_timeline", { startFrame: 50, endFrame: 50 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "endFrame must be greater than startFrame (50)." });
  });

  test("endFrame less than startFrame → error", async () => {
    const store = new EditorStore(makeTimeline(120));
    const executor = new ToolExecutor([inspectTimelineTool()], makeCtx(store, okRenderFrame));
    const result = await executor.execute("inspect_timeline", { startFrame: 50, endFrame: 10 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "endFrame must be greater than startFrame (50)." });
  });

  test("endFrame past totalFrames is clamped, not an error", async () => {
    const store = new EditorStore(makeTimeline(120));
    const executor = new ToolExecutor([inspectTimelineTool()], makeCtx(store, okRenderFrame));
    const result = await executor.execute("inspect_timeline", { endFrame: 99999, maxFrames: 6 });
    expect(result.isError).toBe(false);
    const meta = textBlockPayload(result.blocks);
    expect(meta.frameNumbers).toEqual([10, 30, 50, 70, 90, 110]);
  });

  test("empty timeline → the empty-timeline error", async () => {
    const store = new EditorStore(makeTimeline(0));
    const executor = new ToolExecutor([inspectTimelineTool()], makeCtx(store, okRenderFrame));
    const result = await executor.execute("inspect_timeline", {});
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Timeline is empty — nothing to render." });
  });

  test("wrong-typed arg → a zod validation error, tool never runs", async () => {
    const store = new EditorStore(makeTimeline(120));
    const executor = new ToolExecutor([inspectTimelineTool()], makeCtx(store, okRenderFrame));
    const result = await executor.execute("inspect_timeline", { startFrame: "abc" });
    expect(result.isError).toBe(true);
  });
});

describe("inspect_timeline — catalog registration", () => {
  test("buildCatalog() includes inspect_timeline (catalog 41)", () => {
    const catalog = buildCatalog();
    expect(catalog).toHaveLength(41);
    expect(catalog.map((s) => s.name)).toContain("inspect_timeline");
  });
});
