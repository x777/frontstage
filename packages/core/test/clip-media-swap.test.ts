import { describe, expect, test } from "vitest";
import {
  applySwapClipMedia,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  planSwapClipMedia,
  type Clip,
  type MediaManifestEntry,
  type Timeline,
  type Track,
} from "../src/index.js";

function clip(id: string, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: "old-media",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 12,
    durationFrames: 30,
    trimStartFrame: 10,
    trimEndFrame: 20,
    speed: 1.5,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    ...extra,
  };
}

function asset(id: string, extra: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: id,
    type: "video",
    source: { kind: "external", absolutePath: `/${id}.mp4` },
    duration: 4,
    hasAudio: true,
    ...extra,
  };
}

function timeline(video: Clip, audio?: Clip): Timeline {
  const tracks: Track[] = [
    { id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [video] },
  ];
  if (audio) {
    tracks.push({ id: "a", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [audio] });
  }
  return { ...defaultTimeline(), fps: 30, tracks };
}

describe("planSwapClipMedia", () => {
  test("updates linked A/V that share the source and recomputes trimEnd headroom", () => {
    const video = clip("video-clip", {
      linkGroupId: "linked",
      transform: { ...defaultTransform(), centerX: 0.4, width: 0.7 },
      opacityTrack: { keyframes: [{ frame: 5, value: 0.8, interpolationOut: "smooth" }] },
    });
    const audio = clip("audio-clip", {
      mediaType: "audio",
      sourceClipType: "video",
      linkGroupId: "linked",
      volume: 0.25,
    });
    const tl = timeline(video, audio);
    const planned = planSwapClipMedia(tl, "video-clip", asset("new-media"));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.changed).toBe(true);
    expect(new Set(planned.plan.affectedClipIds)).toEqual(new Set(["video-clip", "audio-clip"]));
    // consumed = round(30 * 1.5) = 45; required = 10 + 45 = 55; available = floor(4 * 30) = 120; trimEnd = 65
    expect(planned.plan.trimEndFrames["video-clip"]).toBe(65);
    expect(planned.plan.trimEndFrames["audio-clip"]).toBe(65);

    const next = applySwapClipMedia(tl, planned.plan);
    const v = next.tracks[0]!.clips[0]!;
    const a = next.tracks[1]!.clips[0]!;
    expect(v.mediaRef).toBe("new-media");
    expect(a.mediaRef).toBe("new-media");
    expect(v.trimEndFrame).toBe(65);
    expect(a.trimEndFrame).toBe(65);
    expect(v.transform).toEqual(video.transform);
    expect(v.opacityTrack).toEqual(video.opacityTrack);
    expect(a.volume).toBe(0.25);
  });

  test("refuses too-short, silent, image, text, and nested sources", () => {
    const video = clip("v", { linkGroupId: "g" });
    const audio = clip("a", { mediaType: "audio", sourceClipType: "video", linkGroupId: "g" });
    const tl = timeline(video, audio);
    expect(planSwapClipMedia(tl, "v", asset("short-media", { duration: 1 })).ok).toBe(false);
    expect(planSwapClipMedia(tl, "v", asset("silent-media", { hasAudio: false })).ok).toBe(false);
    expect(planSwapClipMedia(tl, "v", asset("image-media", { type: "image", duration: 0 })).ok).toBe(false);

    const textTl = timeline(clip("t", { mediaType: "text", sourceClipType: "text", mediaRef: "title" }));
    expect(planSwapClipMedia(textTl, "t", asset("new-media")).ok).toBe(false);

    const nestTl = timeline(clip("n", { sourceClipType: "sequence", mediaRef: "child" }));
    expect(planSwapClipMedia(nestTl, "n", asset("new-media")).ok).toBe(false);
  });

  test("no-op when the replacement is already the source", () => {
    const tl = timeline(clip("v", { mediaRef: "old-media" }));
    const planned = planSwapClipMedia(tl, "v", asset("old-media"));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.changed).toBe(false);
    expect(applySwapClipMedia(tl, planned.plan)).toBe(tl);
  });
});
