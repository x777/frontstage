import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, type MediaManifest, type Track, type Timeline } from "@palmier/core";
import { rippleDeleteRangesTool, insertClipsTool, type ToolContext } from "../src/index.js";

function makeClip(id: string, startFrame: number, durationFrames = 60) {
  return {
    id, mediaRef: "media-1", mediaType: "video" as const, sourceClipType: "video" as const,
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0, speed: 1, volume: 1,
    fadeInFrames: 0, fadeOutFrames: 0, fadeInInterpolation: "linear" as const, fadeOutInterpolation: "linear" as const,
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(),
  };
}
function track(id: string, clips: ReturnType<typeof makeClip>[], over: Partial<Track> = {}): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips, ...over };
}
function tl(tracks: Track[]): Timeline {
  return { ...defaultTimeline(), tracks };
}
const manifest: () => MediaManifest = () => ({ version: 2, entries: [], folders: [] });
function ctx(timeline: Timeline): ToolContext {
  let n = 0;
  return { store: new EditorStore(timeline), getManifest: manifest, newId: () => `id-${n++}` };
}

describe("ripple_delete_ranges", () => {
  test("deletes a frame range on a track and ripples the tail, returning a report", async () => {
    const c = ctx(tl([track("t", [makeClip("a", 0, 100)])]));
    const res = await rippleDeleteRangesTool().run({ trackIndex: 0, ranges: [{ start: 40, end: 60 }] }, c);
    expect(res.isError).toBe(false);
    const block = res.blocks[0]!;
    const text = block.kind === "text" ? block.text : "";
    expect(text).toContain("20 frame");
    const clips = c.store.getSnapshot().timeline.tracks[0]!.clips.slice().sort((x, y) => x.startFrame - y.startFrame);
    expect(clips.length).toBe(2);
    expect(clips[1]!.startFrame).toBe(40);
    expect(c.store.canUndo()).toBe(true);
  });
  test("resolves the track from anchorClipId", async () => {
    const c = ctx(tl([track("t1", []), track("t2", [makeClip("a", 0, 100)])]));
    const res = await rippleDeleteRangesTool().run({ anchorClipId: "a", ranges: [{ start: 40, end: 60 }] }, c);
    expect(res.isError).toBe(false);
  });
  test("supports seconds unit", async () => {
    const c = ctx(tl([track("t", [makeClip("a", 0, 100)])])); // fps 30
    const res = await rippleDeleteRangesTool().run({ trackIndex: 0, ranges: [{ start: 1, end: 2 }], unit: "seconds" }, c);
    expect(res.isError).toBe(false);
    const block = res.blocks[0]!;
    const text = block.kind === "text" ? block.text : "";
    expect(text).toContain("30 frame"); // 1s == 30 frames
  });
  test("cuts a sync-locked track to avoid a shift collision, and ignoreSyncLockedTracks leaves it untouched", async () => {
    const base = () => tl([
      track("v", [makeClip("a", 0, 100)]),
      track("audio", [makeClip("x", 0, 50), makeClip("y", 70, 10)], { type: "audio", syncLocked: true }),
    ]);
    const cutCtx = ctx(base());
    const cut = await rippleDeleteRangesTool().run({ trackIndex: 0, ranges: [{ start: 30, end: 70 }] }, cutCtx);
    expect(cut.isError).toBe(false);
    // x [0,50) trimmed to [0,30) by the cut, y shifted 70 -> 30 lands adjacent instead of colliding
    const cutFollower = cutCtx.store.getSnapshot().timeline.tracks[1]!.clips.slice().sort((p, q) => p.startFrame - q.startFrame);
    expect(cutFollower.map((c) => [c.startFrame, c.startFrame + c.durationFrames])).toEqual([[0, 30], [30, 40]]);

    const ignoredCtx = ctx(base());
    const ignored = await rippleDeleteRangesTool().run({ trackIndex: 0, ranges: [{ start: 30, end: 70 }], ignoreSyncLockedTracks: true }, ignoredCtx);
    expect(ignored.isError).toBe(false);
    const ignoredFollower = ignoredCtx.store.getSnapshot().timeline.tracks[1]!.clips.slice().sort((p, q) => p.startFrame - q.startFrame);
    expect(ignoredFollower.map((c) => [c.startFrame, c.startFrame + c.durationFrames])).toEqual([[0, 50], [70, 80]]); // untouched
  });
  test("rejects out-of-range track / missing anchor", async () => {
    const c = ctx(tl([track("t", [makeClip("a", 0, 100)])]));
    expect((await rippleDeleteRangesTool().run({ trackIndex: 9, ranges: [{ start: 0, end: 10 }] }, c)).isError).toBe(true);
    expect((await rippleDeleteRangesTool().run({ ranges: [{ start: 0, end: 10 }] }, c)).isError).toBe(true);
  });
});

describe("insert_clips", () => {
  function ctxWithMedia(timeline: Timeline): ToolContext {
    let n = 0;
    return {
      store: new EditorStore(timeline),
      getManifest: () => ({ version: 2, entries: [{ id: "m1", name: "v.mp4", type: "video", source: { kind: "external", absolutePath: "/v.mp4" }, duration: 2 }], folders: [] }),
      newId: () => `id-${n++}`,
    };
  }
  test("ripple-inserts a clip, pushing the existing clip right", async () => {
    const c = ctxWithMedia(tl([track("t", [makeClip("old", 0, 30)])]));
    const res = await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", durationFrames: 20 }] }, c);
    expect(res.isError).toBe(false);
    const clips = c.store.getSnapshot().timeline.tracks[0]!.clips.slice().sort((x, y) => x.startFrame - y.startFrame);
    expect(clips.find((x) => x.id === "old")!.startFrame).toBe(20); // pushed by the 20-frame insert
    expect(clips.some((x) => x.startFrame === 0)).toBe(true);
    expect(c.store.canUndo()).toBe(true);
  });
  test("redo reproduces the same clip ids (deterministic)", async () => {
    const c = ctxWithMedia(tl([track("t", [])]));
    await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", durationFrames: 20 }] }, c);
    const idsAfter = c.store.getSnapshot().timeline.tracks[0]!.clips.map((x) => x.id);
    c.store.undo();
    c.store.redo();
    expect(c.store.getSnapshot().timeline.tracks[0]!.clips.map((x) => x.id)).toEqual(idsAfter);
  });
  test("rejects unknown media / out-of-range track", async () => {
    const c = ctxWithMedia(tl([track("t", [])]));
    expect((await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "nope" }] }, c)).isError).toBe(true);
    expect((await insertClipsTool().run({ trackIndex: 9, atFrame: 0, clips: [{ mediaId: "m1" }] }, c)).isError).toBe(true);
  });
  test("trimStartFrame only: the placed clip stays extendable (trimEndFrame is the real remaining tail)", async () => {
    // m1 is 2s @ 30fps = 60 frames. trimStartFrame 10, no durationFrames/trimEndFrame -> runs to the source end.
    const c = ctxWithMedia(tl([track("t", [])]));
    const res = await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", trimStartFrame: 10 }] }, c);
    expect(res.isError).toBe(false);
    const placed = c.store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(placed.trimStartFrame).toBe(10);
    expect(placed.durationFrames).toBe(50); // 60 - 10 - 0
    expect(placed.trimEndFrame).toBe(0);
  });
  test("explicit durationFrames within the source: trimEndFrame is derived, not zeroed, so the clip stays extendable", async () => {
    // m1 is 2s @ 30fps = 60 frames; ask for a 20-frame clip -> 40 frames of real headroom on the tail.
    const c = ctxWithMedia(tl([track("t", [])]));
    const res = await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", durationFrames: 20 }] }, c);
    expect(res.isError).toBe(false);
    const placed = c.store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(placed.durationFrames).toBe(20);
    expect(placed.trimEndFrame).toBe(40); // 60 - 0 - 20, not 0
  });
  test("rejects durationFrames AND trimEndFrame both set", async () => {
    const c = ctxWithMedia(tl([track("t", [])]));
    const res = await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", durationFrames: 20, trimEndFrame: 5 }] }, c);
    expect(res.isError).toBe(true);
  });
  test("rejects a duration that exceeds the source length", async () => {
    const c = ctxWithMedia(tl([track("t", [])]));
    const res = await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", trimStartFrame: 50, durationFrames: 20 }] }, c); // 50+20 > 60
    expect(res.isError).toBe(true);
  });

  // M14C T2: insert_clips inherits the shared resolution auto-match (add_clips' path) — fps is
  // never adopted (#233 standing rule).
  test("adopts the first clip's resolution on an unconfigured timeline; fps untouched", async () => {
    let n = 0;
    const c: ToolContext = {
      store: new EditorStore(tl([track("t", [])])), // defaultTimeline() -> settingsConfigured: false
      getManifest: () => ({
        version: 2,
        entries: [{
          id: "m1", name: "v.mp4", type: "video", source: { kind: "external", absolutePath: "/v.mp4" },
          duration: 2, sourceWidth: 3840, sourceHeight: 2160, sourceFPS: 24,
        }],
        folders: [],
      }),
      newId: () => `id-${n++}`,
    };
    const res = await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", durationFrames: 20 }] }, c);
    expect(res.isError).toBe(false);
    const finalTl = c.store.getSnapshot().timeline;
    expect(finalTl.width).toBe(3840);
    expect(finalTl.height).toBe(2160);
    expect(finalTl.fps).toBe(30);
    expect(finalTl.settingsConfigured).toBe(true);
    const text = res.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("Set timeline to 3840×2160 to match clip.");
  });

  test("configured timeline with existing clips: resolution stays untouched even when a new clip's source differs", async () => {
    let n = 0;
    const c: ToolContext = {
      store: new EditorStore({ ...tl([track("t", [makeClip("old", 0, 30)])]), settingsConfigured: true }),
      getManifest: () => ({
        version: 2,
        entries: [{
          id: "m1", name: "v.mp4", type: "video", source: { kind: "external", absolutePath: "/v.mp4" },
          duration: 2, sourceWidth: 3840, sourceHeight: 2160,
        }],
        folders: [],
      }),
      newId: () => `id-${n++}`,
    };
    const res = await insertClipsTool().run({ trackIndex: 0, atFrame: 0, clips: [{ mediaId: "m1", durationFrames: 20 }] }, c);
    expect(res.isError).toBe(false);
    const finalTl = c.store.getSnapshot().timeline;
    expect(finalTl.width).toBe(1920);
    expect(finalTl.height).toBe(1080);
  });
});
