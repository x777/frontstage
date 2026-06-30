import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, type MediaManifest, type Track, type Timeline } from "@palmier/core";
import { rippleDeleteRangesTool, type ToolContext } from "../src/index.js";

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
  test("refuses when a sync-locked track would collide, and ignoreSyncLockedTracks bypasses it", async () => {
    const base = () => tl([
      track("v", [makeClip("a", 0, 100)]),
      track("audio", [makeClip("x", 0, 50), makeClip("y", 70, 10)], { type: "audio", syncLocked: true }),
    ]);
    const refused = await rippleDeleteRangesTool().run({ trackIndex: 0, ranges: [{ start: 30, end: 70 }] }, ctx(base()));
    expect(refused.isError).toBe(true);
    const ok = await rippleDeleteRangesTool().run({ trackIndex: 0, ranges: [{ start: 30, end: 70 }], ignoreSyncLockedTracks: true }, ctx(base()));
    expect(ok.isError).toBe(false);
  });
  test("rejects out-of-range track / missing anchor", async () => {
    const c = ctx(tl([track("t", [makeClip("a", 0, 100)])]));
    expect((await rippleDeleteRangesTool().run({ trackIndex: 9, ranges: [{ start: 0, end: 10 }] }, c)).isError).toBe(true);
    expect((await rippleDeleteRangesTool().run({ ranges: [{ start: 0, end: 10 }] }, c)).isError).toBe(true);
  });
});
