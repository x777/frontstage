import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { computeZones, videoTrackCount, audioTrackCount, partitionedInsertionIndex, availableAudioTrackIndex } from "./zones.js";

function clip(id: string, startFrame: number, durationFrames: number): Clip {
  return {
    id, mediaRef: "m", mediaType: "audio", sourceClipType: "audio",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}
function track(id: string, type: Track["type"], clips: Clip[] = []): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

describe("computeZones", () => {
  it("firstAudioIndex is the first audio track index", () => {
    const tl = timeline([track("v1", "video"), track("v2", "video"), track("a1", "audio")]);
    const z = computeZones(tl);
    expect(z).toEqual({ trackCount: 3, firstAudioIndex: 2 });
    expect(videoTrackCount(z)).toBe(2);
    expect(audioTrackCount(z)).toBe(1);
  });

  it("firstAudioIndex equals trackCount when there are no audio tracks", () => {
    const tl = timeline([track("v1", "video")]);
    expect(computeZones(tl)).toEqual({ trackCount: 1, firstAudioIndex: 1 });
  });
});

describe("partitionedInsertionIndex", () => {
  const z = { trackCount: 3, firstAudioIndex: 2 }; // 2 visual, 1 audio

  it("clamps visual inserts to at most firstAudioIndex", () => {
    expect(partitionedInsertionIndex(z, "video", 5)).toBe(2);
    expect(partitionedInsertionIndex(z, "image", 1)).toBe(1);
    expect(partitionedInsertionIndex(z, "text", 0)).toBe(0);
  });

  it("clamps audio inserts to at least firstAudioIndex", () => {
    expect(partitionedInsertionIndex(z, "audio", 0)).toBe(2);
    expect(partitionedInsertionIndex(z, "audio", 3)).toBe(3);
  });

  it("bounds the requested index to [0, trackCount]", () => {
    expect(partitionedInsertionIndex(z, "audio", 99)).toBe(3);
    expect(partitionedInsertionIndex(z, "video", -4)).toBe(0);
  });
});

describe("availableAudioTrackIndex", () => {
  it("returns the first audio track with no overlap at [startFrame, startFrame+duration)", () => {
    const busy = track("a1", "audio", [clip("x", 0, 100)]);
    const free = track("a2", "audio", []);
    const tl = timeline([track("v1", "video"), busy, free]);
    expect(availableAudioTrackIndex(tl, 10, 20)).toBe(2); // a1 conflicts, a2 free
  });

  it("returns null when every audio track conflicts", () => {
    const tl = timeline([track("v1", "video"), track("a1", "audio", [clip("x", 0, 100)])]);
    expect(availableAudioTrackIndex(tl, 10, 20)).toBeNull();
  });

  it("treats touching-but-not-overlapping clips as free", () => {
    const tl = timeline([track("a1", "audio", [clip("x", 0, 10)])]);
    expect(availableAudioTrackIndex(tl, 10, 5)).toBe(0); // [10,15) does not overlap [0,10)
  });
});
