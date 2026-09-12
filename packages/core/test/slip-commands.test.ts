import { describe, expect, test } from "vitest";
import { EditorStore } from "../src/editor/editor-store.js";
import { slipClipCommand, slipClips } from "../src/editor/slip-commands.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import type { Clip } from "../src/clip.js";
import type { ClipType } from "../src/clip-type.js";
import type { Timeline } from "../src/timeline.js";

function clip(partial: {
  id: string;
  start?: number;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  mediaType?: ClipType;
  linkGroupId?: string;
}): Clip {
  return {
    id: partial.id,
    mediaRef: partial.id,
    mediaType: partial.mediaType ?? "video",
    sourceClipType: partial.mediaType ?? "video",
    startFrame: partial.start ?? 0,
    durationFrames: partial.duration ?? 60,
    trimStartFrame: partial.trimStart ?? 0,
    trimEndFrame: partial.trimEnd ?? 0,
    speed: partial.speed ?? 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    linkGroupId: partial.linkGroupId,
  };
}

function tl(video: Clip[], audio: Clip[] = []): Timeline {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    settingsConfigured: true,
    tracks: [
      { id: "v", type: "video", muted: false, hidden: false, syncLocked: true, clips: video },
      ...(audio.length
        ? [{ id: "a", type: "audio" as const, muted: false, hidden: false, syncLocked: true, clips: audio }]
        : []),
    ],
  };
}

describe("slipClips", () => {
  test("slip right reveals earlier material", () => {
    const original = clip({ id: "c1", start: 100, duration: 60, trimStart: 30, trimEnd: 20 });
    const next = slipClips(tl([original]), "c1", 10, true);
    const updated = next.tracks[0]!.clips[0]!;
    expect(updated.trimStartFrame).toBe(20);
    expect(updated.trimEndFrame).toBe(30);
    expect(updated.startFrame).toBe(100);
    expect(updated.durationFrames).toBe(60);
  });

  test("slip left reveals later material", () => {
    const next = slipClips(tl([clip({ id: "c1", start: 100, duration: 60, trimStart: 30, trimEnd: 20 })]), "c1", -10, true);
    const updated = next.tracks[0]!.clips[0]!;
    expect(updated.trimStartFrame).toBe(40);
    expect(updated.trimEndFrame).toBe(10);
  });

  test("clamps at head material", () => {
    const next = slipClips(tl([clip({ id: "c1", duration: 60, trimStart: 5, trimEnd: 20 })]), "c1", 30, true);
    const updated = next.tracks[0]!.clips[0]!;
    expect(updated.trimStartFrame).toBe(0);
    expect(updated.trimEndFrame).toBe(25);
  });

  test("clamps at tail material", () => {
    const next = slipClips(tl([clip({ id: "c1", duration: 60, trimStart: 20, trimEnd: 5 })]), "c1", -30, true);
    const updated = next.tracks[0]!.clips[0]!;
    expect(updated.trimStartFrame).toBe(25);
    expect(updated.trimEndFrame).toBe(0);
  });

  test("scales timeline delta through speed", () => {
    const next = slipClips(tl([clip({ id: "c1", duration: 60, trimStart: 40, trimEnd: 40, speed: 2 })]), "c1", 10, true);
    const updated = next.tracks[0]!.clips[0]!;
    expect(updated.trimStartFrame).toBe(20);
    expect(updated.trimEndFrame).toBe(60);
  });

  test("speed-aware clamp keeps trims non-negative", () => {
    const next = slipClips(tl([clip({ id: "c1", duration: 60, trimStart: 10, trimEnd: 40, speed: 2 })]), "c1", 10, true);
    const updated = next.tracks[0]!.clips[0]!;
    expect(updated.trimStartFrame).toBe(0);
    expect(updated.trimEndFrame).toBe(50);
  });

  test("propagates to linked partner and tightest headroom wins", () => {
    const v = clip({ id: "v1", duration: 60, trimStart: 30, trimEnd: 30, linkGroupId: "g1" });
    const a = clip({ id: "a1", duration: 60, trimStart: 8, trimEnd: 30, mediaType: "audio", linkGroupId: "g1" });
    const next = slipClips(tl([v], [a]), "v1", 20, true);
    expect(next.tracks[0]!.clips[0]!.trimStartFrame).toBe(22);
    expect(next.tracks[0]!.clips[0]!.trimEndFrame).toBe(38);
    expect(next.tracks[1]!.clips[0]!.trimStartFrame).toBe(0);
    expect(next.tracks[1]!.clips[0]!.trimEndFrame).toBe(38);
  });

  test("without propagation moves only the lead", () => {
    const v = clip({ id: "v1", duration: 60, trimStart: 30, trimEnd: 30, linkGroupId: "g1" });
    const a = clip({ id: "a1", duration: 60, trimStart: 30, trimEnd: 30, mediaType: "audio", linkGroupId: "g1" });
    const next = slipClips(tl([v], [a]), "v1", 10, false);
    expect(next.tracks[0]!.clips[0]!.trimStartFrame).toBe(20);
    expect(next.tracks[1]!.clips[0]!.trimStartFrame).toBe(30);
  });

  test("refuses image clips", () => {
    const img = clip({ id: "img", mediaType: "image", duration: 60, trimStart: 0, trimEnd: 0 });
    const next = slipClips(tl([img]), "img", 10, true);
    expect(next.tracks[0]!.clips[0]!.trimStartFrame).toBe(0);
  });

  test("zero delta is a no-op", () => {
    const original = tl([clip({ id: "c1", duration: 60, trimStart: 30, trimEnd: 20 })]);
    expect(slipClips(original, "c1", 0, true)).toBe(original);
  });

  test("leaves keyframes untouched", () => {
    const c = clip({ id: "c1", duration: 60, trimStart: 30, trimEnd: 20 });
    c.opacityTrack = { keyframes: [{ frame: 0, value: 1, interpolationOut: "smooth" }, { frame: 30, value: 0.5, interpolationOut: "smooth" }] };
    const next = slipClips(tl([c]), "c1", 10, true);
    expect(next.tracks[0]!.clips[0]!.opacityTrack?.keyframes.map((k) => k.frame)).toEqual([0, 30]);
  });

  test("undo restores original trims", () => {
    const store = new EditorStore(tl([clip({ id: "c1", duration: 60, trimStart: 30, trimEnd: 20 })]));
    store.dispatch(slipClipCommand("c1", 10, true));
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.trimStartFrame).toBe(20);
    store.undo();
    const restored = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(restored.trimStartFrame).toBe(30);
    expect(restored.trimEndFrame).toBe(20);
  });
});
