import { describe, it, expect } from "vitest";
import type { Clip } from "@palmier/core";
import type { Timeline, Track } from "@palmier/core";
import { audioMixClips } from "../src/audio/audio-mixer.js";

function clip(id: string, mediaType: Clip["mediaType"]): Clip {
  return {
    id, mediaRef: "m", mediaType, sourceClipType: mediaType,
    startFrame: 0, durationFrames: 30, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}
function track(id: string, type: Track["type"], clips: Clip[], over: Partial<Track> = {}): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips, ...over };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

describe("audioMixClips", () => {
  it("includes audio clips and excludes video clips", () => {
    const tl = timeline([
      track("vt", "video", [clip("v", "video")]),
      track("at", "audio", [clip("a", "audio")]),
    ]);
    expect(audioMixClips(tl).map((c) => c.id)).toEqual(["a"]);
  });
  it("excludes clips on hidden or muted tracks", () => {
    const tl = timeline([
      track("a1", "audio", [clip("a1c", "audio")], { hidden: true }),
      track("a2", "audio", [clip("a2c", "audio")], { muted: true }),
      track("a3", "audio", [clip("a3c", "audio")]),
    ]);
    expect(audioMixClips(tl).map((c) => c.id)).toEqual(["a3c"]);
  });
});
