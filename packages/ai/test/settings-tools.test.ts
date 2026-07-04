import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  fitTransform,
  type Track,
  type Timeline,
  type MediaManifest,
  type Clip,
} from "@palmier/core";
import { setProjectSettingsTool, ToolExecutor, type ToolContext } from "../src/index.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeClip(id: string, overrides: Partial<Clip> = {}): Clip {
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
    ...overrides,
  };
}

function makeTrack(id = "t1", clips: Clip[] = [makeClip("c1")]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function makeTimeline(clips: Clip[] = [makeClip("c1")]): Timeline {
  return { ...defaultTimeline(), tracks: [makeTrack("t1", clips)] };
}

function makeManifest(sourceWidth?: number, sourceHeight?: number): MediaManifest {
  return {
    version: 2,
    entries: [
      {
        id: "media-1",
        name: "clip.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/clip.mp4" },
        duration: 2,
        sourceWidth,
        sourceHeight,
      },
    ],
    folders: [],
  };
}

let _n = 0;
function makeCtx(store: EditorStore, manifest: MediaManifest = makeManifest()): ToolContext {
  return { store, getManifest: () => manifest, newId: () => `gen-${++_n}` };
}

function makeExecutor(store: EditorStore, manifest?: MediaManifest) {
  return new ToolExecutor([setProjectSettingsTool()], makeCtx(store, manifest));
}

// ── validation matrix (through the executor) ─────────────────────────────────

describe("set_project_settings — validation (Swift-verbatim messages)", () => {
  test("no fields at all", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", {});
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "Provide at least one of: fps, width, height, aspectRatio, quality",
    );
  });

  test("aspectRatio + width is mutually exclusive", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { aspectRatio: "16:9", width: 100 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "'aspectRatio' and explicit 'width'/'height' are mutually exclusive",
    );
  });

  test("aspectRatio + height is mutually exclusive", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { aspectRatio: "16:9", height: 100 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "'aspectRatio' and explicit 'width'/'height' are mutually exclusive",
    );
  });

  test.each([0, -1, 121, 200])("fps out of range: %i", async (fps) => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { fps });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      `fps must be between 1 and 120 (got ${fps})`,
    );
  });

  test("fps at the boundaries (1 and 120) is valid", async () => {
    const store = new EditorStore(makeTimeline());
    const r1 = await makeExecutor(store).execute("set_project_settings", { fps: 1 });
    expect(r1.isError).toBe(false);
    const store2 = new EditorStore(makeTimeline());
    const r2 = await makeExecutor(store2).execute("set_project_settings", { fps: 120 });
    expect(r2.isError).toBe(false);
  });

  test("unknown aspectRatio", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { aspectRatio: "21:9" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "Unknown aspectRatio '21:9'. Use one of: 16:9, 9:16, 1:1, 4:3, 2.4:1, 9:14",
    );
  });

  test("unknown quality", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { quality: "8K" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "Unknown quality '8K'. Use one of: 720p, 1080p, 2K, 4K",
    );
  });

  test("explicit non-positive width", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { width: 0 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "Resolution must have positive width and height",
    );
  });

  test("explicit negative height", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { height: -10 });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "Resolution must have positive width and height",
    );
  });

  test("wrong-typed arg fails at the zod schema gate, run() never called", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { fps: "thirty" });
    expect(result.isError).toBe(true);
  });
});

// ── one undoable dispatch ─────────────────────────────────────────────────────

describe("set_project_settings — mutation is one undo step", () => {
  test("fps-only change dispatches exactly one undo step", async () => {
    const store = new EditorStore(makeTimeline());
    expect(store.canUndo()).toBe(false);
    const result = await makeExecutor(store).execute("set_project_settings", { fps: 60 });
    expect(result.isError).toBe(false);
    expect(store.getSnapshot().timeline.fps).toBe(60);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.canUndo()).toBe(false);
    expect(store.getSnapshot().timeline.fps).toBe(30);
  });

  test("combined fps + resolution change is still ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { fps: 60, width: 1280, height: 720 });
    expect(result.isError).toBe(false);
    store.undo();
    expect(store.canUndo()).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.fps).toBe(30);
    expect(tl.width).toBe(1920);
    expect(tl.height).toBe(1080);
  });

  test("sets settingsConfigured true", async () => {
    const store = new EditorStore(makeTimeline());
    expect(store.getSnapshot().timeline.settingsConfigured).toBe(false);
    await makeExecutor(store).execute("set_project_settings", { fps: 24 });
    expect(store.getSnapshot().timeline.settingsConfigured).toBe(true);
  });

  test("a no-op call (settings already match) still dispatches an undo step (Swift always applies)", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { fps: 30, width: 1920, height: 1080 });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "No change — settings already match: 1920×1080 @ 30fps",
    );
    expect(store.canUndo()).toBe(true);
  });
});

// ── fps changes ONLY from the explicit fps argument ──────────────────────────

describe("set_project_settings — fps is never implicit", () => {
  test("omitted fps never changes fps, even when resolution changes", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { width: 1280, height: 720 });
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.fps).toBe(30);
    expect(tl.width).toBe(1280);
    expect(tl.height).toBe(720);
  });

  test("omitted fps never changes fps via aspectRatio/quality presets", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { aspectRatio: "9:16", quality: "4K" });
    expect(result.isError).toBe(false);
    expect(store.getSnapshot().timeline.fps).toBe(30);
  });
});

// ── fps-change content behavior: Swift rescales; ported verbatim ─────────────

describe("set_project_settings — fps change rescales clip frame data (Swift-verbatim)", () => {
  test("doubling fps (30 -> 60) doubles start/duration/trim/fades", async () => {
    const clip = makeClip("c1", {
      startFrame: 100,
      durationFrames: 60,
      trimStartFrame: 10,
      trimEndFrame: 5,
      fadeInFrames: 6,
      fadeOutFrames: 4,
    });
    const store = new EditorStore(makeTimeline([clip]));
    const result = await makeExecutor(store).execute("set_project_settings", { fps: 60 });
    expect(result.isError).toBe(false);
    const rescaled = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(rescaled.startFrame).toBe(200);
    expect(rescaled.durationFrames).toBe(120);
    expect(rescaled.trimStartFrame).toBe(20);
    expect(rescaled.trimEndFrame).toBe(10);
    expect(rescaled.fadeInFrames).toBe(12);
    expect(rescaled.fadeOutFrames).toBe(8);
  });

  test("halving fps (30 -> 15) rescales keyframes and clamps duration to at least 1", async () => {
    const clip = makeClip("c1", {
      startFrame: 0,
      durationFrames: 10,
      opacityTrack: { keyframes: [{ frame: 0, value: 0, interpolationOut: "linear" }, { frame: 8, value: 1, interpolationOut: "linear" }] },
    });
    const store = new EditorStore(makeTimeline([clip]));
    await makeExecutor(store).execute("set_project_settings", { fps: 15 });
    const rescaled = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(rescaled.durationFrames).toBe(5);
    expect(rescaled.opacityTrack?.keyframes.map((k) => k.frame)).toEqual([0, 4]);
  });

  test("later clips stay non-overlapping under independent rounding (previousEnd clamp)", async () => {
    // fps 30 -> 23: scale = 23/30. Two adjacent clips [0,11) and [11,22) both round their own
    // start/end independently; the second clip's rescaled start must never regress before the
    // first clip's rescaled end.
    const clipA = makeClip("a", { startFrame: 0, durationFrames: 11 });
    const clipB = makeClip("b", { startFrame: 11, durationFrames: 11 });
    const store = new EditorStore(makeTimeline([clipA, clipB]));
    await makeExecutor(store).execute("set_project_settings", { fps: 23 });
    const clips = store.getSnapshot().timeline.tracks[0]!.clips;
    const a = clips.find((c) => c.id === "a")!;
    const b = clips.find((c) => c.id === "b")!;
    expect(b.startFrame).toBeGreaterThanOrEqual(a.startFrame + a.durationFrames);
  });

  test("fps change also rescales the playhead (Swift rescales currentFrame too, outside the undo step)", async () => {
    const store = new EditorStore(makeTimeline());
    store.setPlayhead(50);
    await makeExecutor(store).execute("set_project_settings", { fps: 60 });
    expect(store.getSnapshot().playhead).toBe(100);
    // Not part of the undo step (matches Swift: currentFrame isn't restored by the registered undo).
    store.undo();
    expect(store.getSnapshot().playhead).toBe(100);
  });

  test("fps-only change (no resolution change) does not touch clip transforms", async () => {
    const clip = makeClip("c1", { transform: { ...defaultTransform(), width: 0.4, height: 0.6 } });
    const store = new EditorStore(makeTimeline([clip]));
    await makeExecutor(store).execute("set_project_settings", { fps: 60 });
    const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(after.transform.width).toBe(0.4);
    expect(after.transform.height).toBe(0.6);
  });
});

// ── resolution change re-fits transforms (Swift-verbatim) ────────────────────

describe("set_project_settings — resolution change re-fits transforms", () => {
  test("a clip still at its old auto-fit transform is re-fit to the new canvas", async () => {
    const oldFit = fitTransform({ width: 1080, height: 1920 }, { width: 1920, height: 1080 });
    const clip = makeClip("c1", { transform: oldFit });
    const store = new EditorStore(makeTimeline([clip]));
    const manifest = makeManifest(1080, 1920);
    const result = await makeExecutor(store, manifest).execute("set_project_settings", { aspectRatio: "9:16" });
    expect(result.isError).toBe(false);
    const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    // New canvas (1080x1920) matches the source aspect exactly -> fitTransform is the identity fit.
    expect(after.transform.width).toBeCloseTo(1, 6);
    expect(after.transform.height).toBeCloseTo(1, 6);
  });

  test("a manually-sized transform (not auto-fit) scales proportionally instead of re-fitting", async () => {
    const clip = makeClip("c1", { transform: { ...defaultTransform(), width: 0.5, height: 0.5 } });
    const store = new EditorStore(makeTimeline([clip]));
    const manifest = makeManifest(1080, 1920);
    const result = await makeExecutor(store, manifest).execute("set_project_settings", {
      width: 1080,
      height: 1920,
    });
    expect(result.isError).toBe(false);
    const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    const expectedHeightScale = (1080 * 1080) / (1920 * 1920); // (prevH*newW)/(prevW*newH)
    expect(after.transform.width).toBe(0.5);
    expect(after.transform.height).toBeCloseTo(0.5 * expectedHeightScale, 6);
  });

  test("an animated scaleTrack rescales its b (height) component proportionally", async () => {
    const clip = makeClip("c1", {
      transform: { ...defaultTransform(), width: 0.5, height: 0.5 },
      scaleTrack: {
        keyframes: [
          { frame: 0, value: { a: 0.5, b: 0.5 }, interpolationOut: "linear" },
          { frame: 30, value: { a: 0.5, b: 0.8 }, interpolationOut: "linear" },
        ],
      },
    });
    const store = new EditorStore(makeTimeline([clip]));
    const manifest = makeManifest(1080, 1920);
    const result = await makeExecutor(store, manifest).execute("set_project_settings", {
      width: 1080,
      height: 1920,
    });
    expect(result.isError).toBe(false);
    const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    const expectedHeightScale = (1080 * 1080) / (1920 * 1920);
    expect(after.scaleTrack?.keyframes[0]!.value.a).toBe(0.5);
    expect(after.scaleTrack?.keyframes[0]!.value.b).toBeCloseTo(0.5 * expectedHeightScale, 6);
    expect(after.scaleTrack?.keyframes[1]!.value.b).toBeCloseTo(0.8 * expectedHeightScale, 6);
  });

  test("resolution-only change (no fps change) does not touch clip frame data", async () => {
    const clip = makeClip("c1", { startFrame: 100, durationFrames: 60 });
    const store = new EditorStore(makeTimeline([clip]));
    await makeExecutor(store).execute("set_project_settings", { width: 1280, height: 720 });
    const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(after.startFrame).toBe(100);
    expect(after.durationFrames).toBe(60);
  });

  test("a clip whose media asset has no known source dimensions is left untouched", async () => {
    const clip = makeClip("c1", { transform: { ...defaultTransform(), width: 0.5, height: 0.5 } });
    const store = new EditorStore(makeTimeline([clip]));
    const result = await makeExecutor(store, makeManifest(undefined, undefined)).execute("set_project_settings", {
      width: 1280,
      height: 720,
    });
    expect(result.isError).toBe(false);
    const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(after.transform.width).toBe(0.5);
    expect(after.transform.height).toBe(0.5);
  });
});

// ── presets ───────────────────────────────────────────────────────────────────

describe("set_project_settings — aspectRatio/quality presets", () => {
  test("aspectRatio alone sets the preset resolution", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { aspectRatio: "9:16" });
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.width).toBe(1080);
    expect(tl.height).toBe(1920);
  });

  test("quality alone scales the CURRENT aspect ratio", async () => {
    const store = new EditorStore(makeTimeline()); // 1920x1080, 16:9
    const result = await makeExecutor(store).execute("set_project_settings", { quality: "720p" });
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.width).toBe(1280);
    expect(tl.height).toBe(720);
  });

  test("aspectRatio + quality combined scales the preset", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { aspectRatio: "16:9", quality: "4K" });
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.width).toBe(3840);
    expect(tl.height).toBe(2160);
  });

  test("result message reports both fps and resolution changes", async () => {
    const store = new EditorStore(makeTimeline());
    const result = await makeExecutor(store).execute("set_project_settings", { fps: 24, aspectRatio: "1:1" });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]!.kind === "text" && result.blocks[0]!.text).toBe(
      "Updated: fps 30 → 24, resolution 1920×1080 → 1080×1080. Now 1080×1080 @ 24fps.",
    );
  });
});
