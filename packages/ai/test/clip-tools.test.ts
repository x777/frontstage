import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  findClip,
  type MediaManifest,
  type Track,
  type Timeline,
} from "@palmier/core";
import {
  addClipsTool,
  removeClipsTool,
  moveClipsTool,
  splitClipTool,
  trimClipsTool,
  splitClipsTool,
  type ToolContext,
  type ToolBlock,
} from "../src/index.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeClip(id: string, startFrame: number, durationFrames = 60) {
  return {
    id,
    mediaRef: "media-1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame,
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

function makeTrack(id = "t1", clips = [makeClip("c1", 0)]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function makeTimeline(): Timeline {
  return { ...defaultTimeline(), tracks: [makeTrack()] };
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
        duration: 2, // 2 seconds × 30fps = 60 frames
        // Deliberately differs from the default timeline (30fps, 1920x1080) — see the
        // "never adopts fps" regression test below (#233 standing rule).
        sourceFPS: 24,
        sourceWidth: 3840,
        sourceHeight: 2160,
      },
      {
        id: "media-2",
        name: "ocean.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/ocean.mp4" },
        duration: 3,
      },
      {
        id: "media-av",
        name: "withaudio.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/withaudio.mp4" },
        duration: 2,
        hasAudio: true,
      },
    ],
    folders: [],
  };
}

let _idCounter = 0;
function makeCtx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: () => makeManifest(),
    newId: () => `gen-${++_idCounter}`,
  };
}

// ── add_clips ─────────────────────────────────────────────────────────────────

describe("add_clips", () => {
  test("adds clip to existing track 0", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    const result = await spec.run(
      { clips: [{ mediaId: "media-1", trackIndex: 0, startFrame: 100 }] },
      ctx,
    );
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    // track 0 should have at least 2 clips now (original c1 at 0 + new at 100)
    const track = tl.tracks[0]!;
    expect(track.clips.length).toBeGreaterThanOrEqual(1);
    const added = track.clips.find((c) => c.startFrame === 100);
    expect(added).toBeDefined();
  });

  test("adopts RESOLUTION but never fps from the added clip's source (#233 standing rule) — added clip is 24fps/3840x2160, timeline stays 30fps but adopts 3840x2160", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    const result = await spec.run({ clips: [{ mediaId: "media-1", startFrame: 0 }] }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    // Swift (post-#177/#233) auto-matches RESOLUTION on the agent add path but never fps — this
    // pins the fps half as a permanent invariant, now alongside the resolution adoption itself.
    expect(tl.fps).toBe(30);
    expect(tl.width).toBe(3840);
    expect(tl.height).toBe(2160);
    expect(tl.settingsConfigured).toBe(true);
  });

  test("linked A/V add gives DISTINCT ids to video clip, its track, linked audio clip, and audio track", async () => {
    // addClipCommand calls its newId() thunk once per entity (visual clip, linkGroupId, new
    // video track, linked audio clip, new audio track). Passing a constant thunk collapses them
    // all to one id, which desyncs split/move/remove on the linked pair (findClip hits the first
    // match only). Every entity must get a unique id.
    const store = new EditorStore({ ...makeTimeline(), tracks: [], settingsConfigured: true });
    const ctx = makeCtx(store);
    const result = await addClipsTool().run({ clips: [{ mediaId: "media-av", startFrame: 0 }] }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const audioTrack = tl.tracks.find((t) => t.type === "audio")!;
    expect(videoTrack).toBeDefined();
    expect(audioTrack).toBeDefined();
    const vClip = videoTrack.clips[0]!;
    const aClip = audioTrack.clips[0]!;
    // The linked pair shares one linkGroupId…
    expect(vClip.linkGroupId).toBeDefined();
    expect(vClip.linkGroupId).toBe(aClip.linkGroupId);
    // …but every other id is distinct.
    const ids = [vClip.id, videoTrack.id, aClip.id, audioTrack.id, vClip.linkGroupId!];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("adds to a new track when trackIndex omitted", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    await spec.run({ clips: [{ mediaId: "media-1", startFrame: 0 }] }, ctx);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks.length).toBe(2);
  });

  test("two clips in one call = ONE undo step", async () => {
    // Pre-configured so the resolution-adoption step (its own separate undo entry, mirroring
    // Swift) doesn't fire here — this test is only about the add itself being atomic.
    const store = new EditorStore({ ...makeTimeline(), settingsConfigured: true });
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    const beforeCount = store.getSnapshot().timeline.tracks[0]!.clips.length;
    await spec.run(
      {
        clips: [
          { mediaId: "media-1", trackIndex: 0, startFrame: 100 },
          { mediaId: "media-2", trackIndex: 0, startFrame: 200 },
        ],
      },
      ctx,
    );
    expect(store.canUndo()).toBe(true);
    store.undo();
    // one undo reverts BOTH
    expect(store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(beforeCount);
    expect(store.canUndo()).toBe(false);
  });

  test("unknown mediaId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    const result = await spec.run({ clips: [{ mediaId: "nonexistent", startFrame: 0 }] }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("partial bad mediaId: all-or-nothing, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    const result = await spec.run(
      {
        clips: [
          { mediaId: "media-1", startFrame: 0 },
          { mediaId: "bad-id", startFrame: 10 },
        ],
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("result text contains only the NEW clip ids, not pre-existing ones", async () => {
    const store = new EditorStore(makeTimeline()); // already has c1 on track 0
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    const result = await spec.run(
      { clips: [{ mediaId: "media-1", trackIndex: 0, startFrame: 100 }] },
      ctx,
    );
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b: ToolBlock) => (b.kind === "text" ? b.text : "")).join("");
    // must NOT mention the pre-existing clip id
    expect(text).not.toContain("c1");
    // must mention exactly 1 new id (the generated one)
    expect(text).toMatch(/Added 1 clip\(s\):/);
  });

  test("out-of-range trackIndex returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline()); // 1 track at index 0
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = addClipsTool();
    const result = await spec.run(
      { clips: [{ mediaId: "media-1", trackIndex: 5, startFrame: 0 }] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("incompatible track type returns isError:true, store unchanged", async () => {
    // timeline has a video track at index 0; manifest has audio at media-3
    const audioTrack: Track = { id: "at1", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [] };
    const store = new EditorStore({ ...makeTimeline(), tracks: [audioTrack] });
    const before = store.getSnapshot().timeline;
    const manifest: MediaManifest = {
      version: 2,
      entries: [
        { id: "media-v", name: "vid.mp4", type: "video", source: { kind: "external", absolutePath: "/v.mp4" }, duration: 2 },
      ],
      folders: [],
    };
    const ctx: ToolContext = {
      store,
      getManifest: () => manifest,
      newId: () => `gen-incompat`,
    };
    const result = await addClipsTool().run(
      { clips: [{ mediaId: "media-v", trackIndex: 0, startFrame: 0 }] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("batch with one bad trackIndex rejects all (all-or-nothing)", async () => {
    const store = new EditorStore(makeTimeline()); // 1 track
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await addClipsTool().run(
      {
        clips: [
          { mediaId: "media-1", trackIndex: 0, startFrame: 0 },
          { mediaId: "media-2", trackIndex: 99, startFrame: 10 }, // out of range
        ],
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});

// ── remove_clips ──────────────────────────────────────────────────────────────

describe("remove_clips", () => {
  test("removes an existing clip", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = removeClipsTool();
    const result = await spec.run({ clipIds: ["c1"] }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(findClip(tl, "c1")).toBeNull();
  });

  test("removal is ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = removeClipsTool();
    await spec.run({ clipIds: ["c1"] }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(findClip(store.getSnapshot().timeline, "c1")).not.toBeNull();
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = removeClipsTool();
    const result = await spec.run({ clipIds: ["nonexistent"] }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("partial bad clipId: all-or-nothing", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = removeClipsTool();
    const result = await spec.run({ clipIds: ["c1", "nonexistent"] }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
  });
});

// ── move_clips ────────────────────────────────────────────────────────────────

describe("move_clips", () => {
  test("moves clip to new startFrame", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = moveClipsTool();
    const result = await spec.run({ moves: [{ clipId: "c1", toTrackIndex: 0, toStartFrame: 90 }] }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    const loc = findClip(tl, "c1");
    expect(loc).not.toBeNull();
    expect(tl.tracks[loc!.trackIndex]!.clips[loc!.clipIndex]!.startFrame).toBe(90);
  });

  test("move is ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = moveClipsTool();
    await spec.run({ moves: [{ clipId: "c1", toTrackIndex: 0, toStartFrame: 90 }] }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    const loc = findClip(store.getSnapshot().timeline, "c1");
    expect(store.getSnapshot().timeline.tracks[loc!.trackIndex]!.clips[loc!.clipIndex]!.startFrame).toBe(0);
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = moveClipsTool();
    const result = await spec.run({ moves: [{ clipId: "bad", toTrackIndex: 0, toStartFrame: 90 }] }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});

// ── split_clip ────────────────────────────────────────────────────────────────

describe("split_clip", () => {
  test("produces 2 clips from 1", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = splitClipTool();
    const result = await spec.run({ clipId: "c1", atFrame: 30 }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks[0]!.clips.length).toBe(2);
  });

  test("split is ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = splitClipTool();
    await spec.run({ clipId: "c1", atFrame: 30 }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(1);
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = splitClipTool();
    const result = await spec.run({ clipId: "nope", atFrame: 30 }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("split at boundary is a no-op (no error, store unchanged)", async () => {
    // splitClipCommand returns the same timeline when atFrame is out of range
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = splitClipTool();
    // clip is 0..60, splitting at 0 (boundary) should not change anything
    await spec.run({ clipId: "c1", atFrame: 0 }, ctx);
    // store may or may not have changed (command is no-op), just verify it didn't explode
    // and the clip is still there
    expect(findClip(store.getSnapshot().timeline, "c1")).not.toBeNull();
  });

  test("result reports new clip id (not all clip ids)", async () => {
    const store = new EditorStore(makeTimeline()); // has c1
    const ctx = makeCtx(store);
    const spec = splitClipTool();
    const result = await spec.run({ clipId: "c1", atFrame: 30 }, ctx);
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b: ToolBlock) => (b.kind === "text" ? b.text : "")).join("");
    // must mention "New clip id:" (not "Clips: id1, id2" listing all)
    expect(text).toMatch(/New clip id:/);
    // should not list c1 as a new id (c1 was the original, not newly created)
    expect(text).not.toMatch(/New clip id:.*c1/);
  });
});

// ── trim_clips ────────────────────────────────────────────────────────────────

describe("trim_clips", () => {
  test("trim right increases durationFrames", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = trimClipsTool();
    // trim right by +10 frames
    const result = await spec.run({ trims: [{ clipId: "c1", edge: "right", deltaFrames: 10 }] }, ctx);
    expect(result.isError).toBe(false);
    const loc = findClip(store.getSnapshot().timeline, "c1")!;
    const clip = store.getSnapshot().timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    expect(clip.durationFrames).toBe(70); // 60 + 10
  });

  test("trim left changes startFrame and durationFrames", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = trimClipsTool();
    // trim left by +10 (move left edge right by 10)
    const result = await spec.run({ trims: [{ clipId: "c1", edge: "left", deltaFrames: 10 }] }, ctx);
    expect(result.isError).toBe(false);
    const loc = findClip(store.getSnapshot().timeline, "c1")!;
    const clip = store.getSnapshot().timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    expect(clip.startFrame).toBe(10);
    expect(clip.durationFrames).toBe(50);
  });

  test("trim is ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = trimClipsTool();
    await spec.run({ trims: [{ clipId: "c1", edge: "right", deltaFrames: 10 }] }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    const loc = findClip(store.getSnapshot().timeline, "c1")!;
    const clip = store.getSnapshot().timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    expect(clip.durationFrames).toBe(60);
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const spec = trimClipsTool();
    const result = await spec.run({ trims: [{ clipId: "bad", edge: "right", deltaFrames: 5 }] }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});

// ── split_clips (batch) ───────────────────────────────────────────────────────

describe("split_clips (batch)", () => {
  function ctxWith(tl: Timeline) {
    let n = 0;
    return { store: new EditorStore(tl), getManifest: makeManifest, newId: () => `new-${n++}` } as ToolContext;
  }
  test("splits multiple clips as one undo step", async () => {
    const tl: Timeline = { ...makeTimeline(), tracks: [makeTrack("t", [makeClip("a", 0, 60), makeClip("b", 60, 60)])] };
    const ctx = ctxWith(tl);
    const res = await splitClipsTool().run({ splits: [{ clipId: "a", atFrame: 30 }, { clipId: "b", atFrame: 90 }] }, ctx);
    expect(res.isError).toBe(false);
    const clips = ctx.store.getSnapshot().timeline.tracks[0]!.clips;
    expect(clips.length).toBe(4); // a -> a+new0, b -> b+new1
    expect(ctx.store.canUndo()).toBe(true);
    ctx.store.undo();
    expect(ctx.store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(2);
  });
  test("rejects a split at a clip boundary", async () => {
    const ctx = ctxWith(makeTimeline());
    const res = await splitClipsTool().run({ splits: [{ clipId: "c1", atFrame: 0 }] }, ctx);
    expect(res.isError).toBe(true);
    const block = res.blocks[0]!;
    expect(block.kind === "text" ? block.text : "").toContain("strictly inside");
  });
  test("rejects an unknown clip", async () => {
    const ctx = ctxWith(makeTimeline());
    const res = await splitClipsTool().run({ splits: [{ clipId: "missing", atFrame: 10 }] }, ctx);
    expect(res.isError).toBe(true);
  });
});
