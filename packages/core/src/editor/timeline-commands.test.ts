import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Track } from "../timeline.js";
import type { Timeline } from "../timeline.js";
import { EditorStore } from "./editor-store.js";
import {
  replaceClip,
  replaceTrackClips,
  moveClipCommand,
  trimClipCommand,
  splitClipCommand,
} from "./timeline-commands.js";

// --- Test fixture helpers ---

function makeClip(overrides: Partial<Clip> & { id: string }): Clip {
  return {
    mediaRef: "asset-1",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 30,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: { centerX: 0, centerY: 0, width: 1920, height: 1080, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    ...overrides,
  };
}

function makeTrack(overrides: Partial<Track> & { id: string; clips: Clip[] }): Track {
  return {
    type: "video",
    muted: false,
    hidden: false,
    syncLocked: false,
    ...overrides,
  };
}

function makeTimeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

// A simple deterministic clip id generator for split tests
const mkId = (id: string) => () => id;

// --- replaceClip / replaceTrackClips helpers ---

describe("replaceTrackClips", () => {
  it("returns same ref when trackIndex out of range", () => {
    const clip = makeClip({ id: "c1" });
    const track = makeTrack({ id: "t1", clips: [clip] });
    const tl = makeTimeline([track]);
    expect(replaceTrackClips(tl, 5, [])).toBe(tl);
  });

  it("replaces clips immutably", () => {
    const clip = makeClip({ id: "c1" });
    const track = makeTrack({ id: "t1", clips: [clip] });
    const tl = makeTimeline([track]);
    const newClips: Clip[] = [];
    const result = replaceTrackClips(tl, 0, newClips);
    expect(result).not.toBe(tl);
    expect(result.tracks[0]!.clips).toBe(newClips);
  });
});

describe("replaceClip", () => {
  it("returns same ref when clipId not found", () => {
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [] })]);
    expect(replaceClip(tl, "missing", (c) => c)).toBe(tl);
  });

  it("returns same ref when updater returns same clip", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    expect(replaceClip(tl, "c1", (c) => c)).toBe(tl);
  });

  it("replaces clip immutably", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = replaceClip(tl, "c1", (c) => ({ ...c, volume: 0.5 }));
    expect(result).not.toBe(tl);
    expect(result.tracks[0]!.clips[0]!.volume).toBe(0.5);
  });
});

// --- moveClipCommand ---

describe("moveClipCommand", () => {
  it("changes startFrame", () => {
    const clip = makeClip({ id: "c1", startFrame: 0 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = moveClipCommand("c1", 0, 15).apply(tl);
    expect(result.tracks[0]!.clips[0]!.startFrame).toBe(15);
  });

  it("clamps startFrame to >= 0", () => {
    const clip = makeClip({ id: "c1", startFrame: 5 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = moveClipCommand("c1", 0, -10).apply(tl);
    expect(result.tracks[0]!.clips[0]!.startFrame).toBe(0);
  });

  it("returns same ref for missing clip", () => {
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [] })]);
    expect(moveClipCommand("missing", 0, 5).apply(tl)).toBe(tl);
  });

  it("returns same ref for out-of-range track", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    expect(moveClipCommand("c1", 99, 5).apply(tl)).toBe(tl);
  });

  it("returns same ref for incompatible track type", () => {
    const clip = makeClip({ id: "c1", mediaType: "video" });
    const audioTrack = makeTrack({ id: "t2", type: "audio", clips: [] });
    const videoTrack = makeTrack({ id: "t1", type: "video", clips: [clip] });
    const tl = makeTimeline([videoTrack, audioTrack]);
    expect(moveClipCommand("c1", 1, 5).apply(tl)).toBe(tl);
  });

  it("moves clip to a different track", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, mediaType: "video" });
    const track1 = makeTrack({ id: "t1", type: "video", clips: [clip] });
    const track2 = makeTrack({ id: "t2", type: "video", clips: [] });
    const tl = makeTimeline([track1, track2]);
    const result = moveClipCommand("c1", 1, 10).apply(tl);
    expect(result.tracks[0]!.clips).toHaveLength(0);
    expect(result.tracks[1]!.clips).toHaveLength(1);
    expect(result.tracks[1]!.clips[0]!.startFrame).toBe(10);
  });

  it("re-sorts by startFrame after move", () => {
    const c1 = makeClip({ id: "c1", startFrame: 20 });
    const c2 = makeClip({ id: "c2", startFrame: 40 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [c1, c2] })]);
    // Move c2 before c1
    const result = moveClipCommand("c2", 0, 0).apply(tl);
    expect(result.tracks[0]!.clips[0]!.id).toBe("c2");
    expect(result.tracks[0]!.clips[1]!.id).toBe("c1");
  });

  it("compatible visual types can move between tracks (video->image track)", () => {
    const clip = makeClip({ id: "c1", mediaType: "video" });
    const track1 = makeTrack({ id: "t1", type: "video", clips: [clip] });
    const track2 = makeTrack({ id: "t2", type: "image", clips: [] });
    const tl = makeTimeline([track1, track2]);
    const result = moveClipCommand("c1", 1, 5).apply(tl);
    expect(result.tracks[1]!.clips).toHaveLength(1);
  });
});

// --- trimClipCommand ---

describe("trimClipCommand — left edge", () => {
  it("no-op when deltaFrames === 0", () => {
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 30 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    expect(trimClipCommand("c1", "left", 0).apply(tl)).toBe(tl);
  });

  it("no-op for missing clip", () => {
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [] })]);
    expect(trimClipCommand("missing", "left", 5).apply(tl)).toBe(tl);
  });

  it("sourced clip speed=1: updates startFrame, duration, trimStart", () => {
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 30, trimStartFrame: 5, speed: 1 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = trimClipCommand("c1", "left", 5).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.startFrame).toBe(15);      // 10 + 5
    expect(c.durationFrames).toBe(25);  // 30 - 5
    expect(c.trimStartFrame).toBe(10);  // 5 + round(5*1)
  });

  it("sourced clip speed=2: trimStart advances by round(delta*speed)", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, trimStartFrame: 0, speed: 2 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = trimClipCommand("c1", "left", 4).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.startFrame).toBe(4);
    expect(c.durationFrames).toBe(26);
    expect(c.trimStartFrame).toBe(8);  // 0 + round(4*2)
  });

  it("image clip: trimStart unchanged (hasNoSource)", () => {
    const clip = makeClip({ id: "c1", mediaType: "image", startFrame: 10, durationFrames: 30, trimStartFrame: 5, speed: 1 });
    const tl = makeTimeline([makeTrack({ id: "t1", type: "image", clips: [clip] })]);
    const result = trimClipCommand("c1", "left", 5).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.startFrame).toBe(15);
    expect(c.durationFrames).toBe(25);
    expect(c.trimStartFrame).toBe(5);   // unchanged for image
  });

  it("text clip: trimStart unchanged (hasNoSource)", () => {
    const clip = makeClip({ id: "c1", mediaType: "text", startFrame: 0, durationFrames: 20, trimStartFrame: 3, speed: 1 });
    const tl = makeTimeline([makeTrack({ id: "t1", type: "text", clips: [clip] })]);
    const result = trimClipCommand("c1", "left", 5).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.trimStartFrame).toBe(3);
  });

  it("negative delta trims outward (extend left)", () => {
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 20, trimStartFrame: 5, speed: 1 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = trimClipCommand("c1", "left", -3).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.startFrame).toBe(7);      // 10 - 3
    expect(c.durationFrames).toBe(23); // 20 + 3
    expect(c.trimStartFrame).toBe(2);  // 5 - round(3*1)
  });
});

describe("trimClipCommand — right edge", () => {
  it("no-op when deltaFrames === 0", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    expect(trimClipCommand("c1", "right", 0).apply(tl)).toBe(tl);
  });

  it("sourced clip speed=1: updates duration, trimEnd", () => {
    // delta = -5 (trimming inward from right)
    // newDuration = 30 + (-5) = 25
    // newTrimEnd = trimEnd - round(delta*speed) = 10 - round(-5*1) = 10 + 5 = 15
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, trimEndFrame: 10, speed: 1 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = trimClipCommand("c1", "right", -5).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.startFrame).toBe(0);         // unchanged
    expect(c.durationFrames).toBe(25);    // 30 - 5
    expect(c.trimEndFrame).toBe(15);      // 10 - round(-5*1) = 15
  });

  it("sourced clip speed=2: trimEnd adjusts by round(delta*speed)", () => {
    // delta = -4, speed = 2
    // newDuration = 30 + (-4) = 26
    // newTrimEnd = trimEnd - round(delta*speed) = 20 - round(-4*2) = 20 + 8 = 28
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, trimEndFrame: 20, speed: 2 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = trimClipCommand("c1", "right", -4).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.durationFrames).toBe(26);     // 30 - 4
    expect(c.trimEndFrame).toBe(28);       // 20 - round(-4*2) = 28
  });

  it("image clip: trimEnd unchanged (hasNoSource)", () => {
    // delta = -5 (trimming inward), image => trimEndFrame stays unchanged
    const clip = makeClip({ id: "c1", mediaType: "image", durationFrames: 30, trimEndFrame: 5, speed: 1 });
    const tl = makeTimeline([makeTrack({ id: "t1", type: "image", clips: [clip] })]);
    const result = trimClipCommand("c1", "right", -5).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.durationFrames).toBe(25);
    expect(c.trimEndFrame).toBe(5);  // unchanged for image
  });

  it("positive delta extends to the right", () => {
    // delta = +5, speed = 1
    // newDuration = 20 + 5 = 25
    // newTrimEnd = 10 - round(5*1) = 5
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 20, trimEndFrame: 10, speed: 1 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = trimClipCommand("c1", "right", 5).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.durationFrames).toBe(25);
    expect(c.trimEndFrame).toBe(5);    // 10 - round(5*1) = 5
  });
});

// --- splitClipCommand ---

describe("splitClipCommand", () => {
  it("no-op when atFrame <= startFrame", () => {
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 20 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    expect(splitClipCommand("c1", 10, undefined, mkId("r")).apply(tl)).toBe(tl);
    expect(splitClipCommand("c1", 5, undefined, mkId("r")).apply(tl)).toBe(tl);
  });

  it("no-op when atFrame >= clipEnd", () => {
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 20 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    expect(splitClipCommand("c1", 30, undefined, mkId("r")).apply(tl)).toBe(tl);
    expect(splitClipCommand("c1", 31, undefined, mkId("r")).apply(tl)).toBe(tl);
  });

  it("no-op for missing clip", () => {
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [] })]);
    expect(splitClipCommand("missing", 5).apply(tl)).toBe(tl);
  });

  it("produces two clips with correct durations", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, speed: 1, trimStartFrame: 0, trimEndFrame: 0 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = splitClipCommand("c1", 10, undefined, mkId("right")).apply(tl);
    const clips = result.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    // left
    const left = clips.find((c) => c.id === "c1")!;
    const right = clips.find((c) => c.id === "right")!;
    expect(left.durationFrames).toBe(10);   // splitOffset
    expect(right.durationFrames).toBe(20);  // 30 - 10
    expect(right.startFrame).toBe(10);      // atFrame
  });

  it("left.trimEndFrame and right.trimStartFrame correct (speed=1)", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, speed: 1, trimStartFrame: 5, trimEndFrame: 7 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = splitClipCommand("c1", 10, undefined, mkId("right")).apply(tl);
    const left = result.tracks[0]!.clips.find((c) => c.id === "c1")!;
    const right = result.tracks[0]!.clips.find((c) => c.id === "right")!;
    // leftSource = round(10*1) = 10, rightSource = round(20*1) = 20
    expect(left.trimEndFrame).toBe(7 + 20);   // clip.trimEndFrame + rightSource
    expect(right.trimStartFrame).toBe(5 + 10); // clip.trimStartFrame + leftSource
  });

  it("trim math correct for speed=2", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, speed: 2, trimStartFrame: 0, trimEndFrame: 0 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = splitClipCommand("c1", 10, undefined, mkId("right")).apply(tl);
    const left = result.tracks[0]!.clips.find((c) => c.id === "c1")!;
    const right = result.tracks[0]!.clips.find((c) => c.id === "right")!;
    // leftSource = round(10*2)=20, rightSource = round(20*2)=40
    expect(left.trimEndFrame).toBe(0 + 40);     // trimEndFrame + rightSource
    expect(right.trimStartFrame).toBe(0 + 20);  // trimStartFrame + leftSource
  });

  it("resets fadeOut on left and fadeIn on right", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, fadeInFrames: 5, fadeOutFrames: 5 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = splitClipCommand("c1", 15, undefined, mkId("right")).apply(tl);
    const left = result.tracks[0]!.clips.find((c) => c.id === "c1")!;
    const right = result.tracks[0]!.clips.find((c) => c.id === "right")!;
    expect(left.fadeOutFrames).toBe(0);
    expect(right.fadeInFrames).toBe(0);
    // fadeIn preserved on left, fadeOut preserved on right
    expect(left.fadeInFrames).toBe(5);
    expect(right.fadeOutFrames).toBe(5);
  });

  it("volume-track: boundary keyframes keep continuity", () => {
    const clip = makeClip({
      id: "c1",
      startFrame: 0,
      durationFrames: 30,
      speed: 1,
      trimStartFrame: 0,
      trimEndFrame: 0,
      volumeTrack: {
        keyframes: [
          { frame: 0, value: 0, interpolationOut: "linear" },
          { frame: 30, value: 6, interpolationOut: "linear" },
        ],
      },
    });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = splitClipCommand("c1", 15, undefined, mkId("right")).apply(tl);
    const left = result.tracks[0]!.clips.find((c) => c.id === "c1")!;
    const right = result.tracks[0]!.clips.find((c) => c.id === "right")!;

    // boundary value at splitOffset=15: lerp(0,6, 15/30)=3
    const leftLastKf = left.volumeTrack!.keyframes.at(-1)!;
    const rightFirstKf = right.volumeTrack!.keyframes[0]!;
    expect(leftLastKf.frame).toBe(15);
    expect(leftLastKf.value).toBe(3);
    expect(rightFirstKf.frame).toBe(0);
    expect(rightFirstKf.value).toBe(3);
  });

  it("volume-track right kfs are rebased (offset by -splitOffset)", () => {
    const clip = makeClip({
      id: "c1",
      startFrame: 0,
      durationFrames: 30,
      speed: 1,
      trimStartFrame: 0,
      trimEndFrame: 0,
      volumeTrack: {
        keyframes: [
          { frame: 0, value: 0, interpolationOut: "linear" },
          { frame: 20, value: 4, interpolationOut: "linear" },
          { frame: 30, value: 6, interpolationOut: "linear" },
        ],
      },
    });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const result = splitClipCommand("c1", 10, undefined, mkId("right")).apply(tl);
    const right = result.tracks[0]!.clips.find((c) => c.id === "right")!;
    // kf at frame 20 becomes frame 10 (20-10), kf at 30 becomes 20 (30-10)
    const frames = right.volumeTrack!.keyframes.map((k) => k.frame);
    expect(frames).toContain(10); // 20-10
    expect(frames).toContain(20); // 30-10
  });

  it("clips are sorted after split", () => {
    const c1 = makeClip({ id: "c1", startFrame: 50, durationFrames: 30 });
    const c2 = makeClip({ id: "c2", startFrame: 10, durationFrames: 20 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [c1, c2] })]);
    const result = splitClipCommand("c1", 60, undefined, mkId("c1right")).apply(tl);
    const starts = result.tracks[0]!.clips.map((c) => c.startFrame);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

// --- EditorStore dispatch + undo round-trip ---

describe("EditorStore undo round-trip", () => {
  it("moveClipCommand round-trips via undo", () => {
    const clip = makeClip({ id: "c1", startFrame: 0 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    store.dispatch(moveClipCommand("c1", 0, 20));
    expect(store.getSnapshot().timeline).not.toBe(prior);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });

  it("trimClipCommand round-trips via undo", () => {
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 30 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    store.dispatch(trimClipCommand("c1", "left", 5));
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });

  it("splitClipCommand round-trips via undo", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    store.dispatch(splitClipCommand("c1", 15, undefined, mkId("right")));
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(2);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });

  it("no-op command does not push to undo stack", () => {
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [] })]);
    const store = new EditorStore(tl);
    store.dispatch(moveClipCommand("missing", 0, 5)); // no-op
    expect(store.canUndo()).toBe(false);
  });

  it("coalesceKey merges consecutive dispatches into one undo step", () => {
    const clip = makeClip({ id: "c1", startFrame: 0 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    store.dispatch(moveClipCommand("c1", 0, 10, "drag-c1"));
    store.dispatch(moveClipCommand("c1", 0, 20, "drag-c1"));
    store.dispatch(moveClipCommand("c1", 0, 30, "drag-c1"));
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.startFrame).toBe(30);
    store.undo();
    // single undo should go back to prior
    expect(store.getSnapshot().timeline).toBe(prior);
  });
});

// --- clipFromAsset + addClipCommand ---

import { clipFromAsset, addClipCommand } from "./timeline-commands.js";
import type { MediaManifestEntry } from "../media.js";
import type { TrackDropTarget } from "../timeline/geometry.js";

function makeEntry(overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id: "asset-42",
    name: "clip.mp4",
    type: "video",
    source: { kind: "external", absolutePath: "/tmp/clip.mp4" },
    duration: 5,
    ...overrides,
  };
}

let _idCounter = 0;
const mkNewId = () => {
  _idCounter++;
  return `generated-${_idCounter}`;
};

describe("clipFromAsset", () => {
  it("sets durationFrames = max(1, round(duration * fps))", () => {
    const entry = makeEntry({ duration: 5 });
    const clip = clipFromAsset(entry, 30, 0, mkNewId);
    expect(clip.durationFrames).toBe(150);
  });

  it("durationFrames minimum is 1 when duration=0", () => {
    const entry = makeEntry({ duration: 0 });
    const clip = clipFromAsset(entry, 30, 0, mkNewId);
    expect(clip.durationFrames).toBe(1);
  });

  it("rounds fractional duration*fps", () => {
    const entry = makeEntry({ duration: 1 / 3 });
    const clip = clipFromAsset(entry, 30, 0, mkNewId);
    expect(clip.durationFrames).toBe(Math.max(1, Math.round((1 / 3) * 30)));
  });

  it("mediaType and sourceClipType equal entry.type", () => {
    const entry = makeEntry({ type: "audio" });
    const clip = clipFromAsset(entry, 30, 0, mkNewId);
    expect(clip.mediaType).toBe("audio");
    expect(clip.sourceClipType).toBe("audio");
  });

  it("mediaRef equals entry.id", () => {
    const entry = makeEntry({ id: "my-asset" });
    const clip = clipFromAsset(entry, 30, 0, mkNewId);
    expect(clip.mediaRef).toBe("my-asset");
  });

  it("default trim=0/0, speed=1, volume=1, opacity=1, fades=0 linear", () => {
    const clip = clipFromAsset(makeEntry(), 30, 0, mkNewId);
    expect(clip.trimStartFrame).toBe(0);
    expect(clip.trimEndFrame).toBe(0);
    expect(clip.speed).toBe(1);
    expect(clip.volume).toBe(1);
    expect(clip.opacity).toBe(1);
    expect(clip.fadeInFrames).toBe(0);
    expect(clip.fadeOutFrames).toBe(0);
    expect(clip.fadeInInterpolation).toBe("linear");
    expect(clip.fadeOutInterpolation).toBe("linear");
  });

  it("default transform has centered position and unit scale", () => {
    const clip = clipFromAsset(makeEntry(), 30, 0, mkNewId);
    expect(clip.transform.centerX).toBe(0.5);
    expect(clip.transform.centerY).toBe(0.5);
    expect(clip.transform.width).toBe(1);
    expect(clip.transform.height).toBe(1);
    expect(clip.transform.rotation).toBe(0);
    expect(clip.transform.flipHorizontal).toBe(false);
    expect(clip.transform.flipVertical).toBe(false);
  });

  it("default crop is zero", () => {
    const clip = clipFromAsset(makeEntry(), 30, 0, mkNewId);
    expect(clip.crop).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("startFrame is passed through", () => {
    const clip = clipFromAsset(makeEntry(), 30, 45, mkNewId);
    expect(clip.startFrame).toBe(45);
  });
});

describe("addClipCommand — existing track", () => {
  it("inserts clip onto existing track", () => {
    const track = makeTrack({ id: "t1", type: "video", clips: [] });
    const tl = makeTimeline([track]);
    const entry = makeEntry({ duration: 1 });
    const target: TrackDropTarget = { kind: "existing", index: 0 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    expect(result.tracks[0]!.clips).toHaveLength(1);
    expect(result.tracks[0]!.clips[0]!.durationFrames).toBe(30);
  });

  it("overwrites an overlapping clip", () => {
    const existing = makeClip({ id: "old", startFrame: 0, durationFrames: 60 });
    const track = makeTrack({ id: "t1", type: "video", clips: [existing] });
    const tl = makeTimeline([track]);
    const entry = makeEntry({ duration: 1 });
    const target: TrackDropTarget = { kind: "existing", index: 0 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    const clips = result.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    const inserted = clips.find((c) => c.startFrame === 0)!;
    const trimmed = clips.find((c) => c.startFrame === 30)!;
    expect(inserted).toBeDefined();
    expect(trimmed).toBeDefined();
    expect(trimmed.durationFrames).toBe(30);
  });

  it("incompatible track type (video entry on audio track) → no-op same ref", () => {
    const track = makeTrack({ id: "t1", type: "audio", clips: [] });
    const tl = makeTimeline([track]);
    const entry = makeEntry({ type: "video" });
    const target: TrackDropTarget = { kind: "existing", index: 0 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    expect(result).toBe(tl);
  });

  it("out-of-range track index → no-op same ref", () => {
    const tl = makeTimeline([]);
    const entry = makeEntry();
    const target: TrackDropTarget = { kind: "existing", index: 5 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    expect(result).toBe(tl);
  });

  it("clamps negative startFrame to 0", () => {
    const track = makeTrack({ id: "t1", type: "video", clips: [] });
    const tl = makeTimeline([track]);
    const entry = makeEntry({ duration: 1 });
    const target: TrackDropTarget = { kind: "existing", index: 0 };
    const result = addClipCommand(entry, target, -10, 30, undefined, mkNewId).apply(tl);
    expect(result.tracks[0]!.clips[0]!.startFrame).toBe(0);
  });
});

describe("addClipCommand — new track", () => {
  it("inserts a new track at the specified index", () => {
    const track = makeTrack({ id: "t1", type: "video", clips: [] });
    const tl = makeTimeline([track]);
    const entry = makeEntry();
    const target: TrackDropTarget = { kind: "new", index: 0 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]!.clips).toHaveLength(1);
    expect(result.tracks[1]!.id).toBe("t1");
  });

  it("appends a new track at end when index >= trackCount", () => {
    const track = makeTrack({ id: "t1", type: "video", clips: [] });
    const tl = makeTimeline([track]);
    const entry = makeEntry();
    const target: TrackDropTarget = { kind: "new", index: 1 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]!.id).toBe("t1");
    expect(result.tracks[1]!.clips).toHaveLength(1);
  });

  it("new track has correct mediaType, muted=false, hidden=false, syncLocked=false", () => {
    const tl = makeTimeline([]);
    const entry = makeEntry({ type: "audio" });
    const target: TrackDropTarget = { kind: "new", index: 0 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    const newTrack = result.tracks[0]!;
    expect(newTrack.type).toBe("audio");
    expect(newTrack.muted).toBe(false);
    expect(newTrack.hidden).toBe(false);
    expect(newTrack.syncLocked).toBe(false);
  });

  it("new track clamps out-of-range index", () => {
    const tl = makeTimeline([]);
    const entry = makeEntry();
    const target: TrackDropTarget = { kind: "new", index: 999 };
    const result = addClipCommand(entry, target, 0, 30, undefined, mkNewId).apply(tl);
    expect(result.tracks).toHaveLength(1);
  });
});

describe("addClipCommand — undo round-trip", () => {
  it("existing track add round-trips via undo", () => {
    const track = makeTrack({ id: "t1", type: "video", clips: [] });
    const tl = makeTimeline([track]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    const entry = makeEntry({ duration: 1 });
    const target: TrackDropTarget = { kind: "existing", index: 0 };
    store.dispatch(addClipCommand(entry, target, 0, 30, undefined, mkNewId));
    expect(store.getSnapshot().timeline).not.toBe(prior);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });

  it("new track add round-trips via undo", () => {
    const tl = makeTimeline([]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    const entry = makeEntry();
    const target: TrackDropTarget = { kind: "new", index: 0 };
    store.dispatch(addClipCommand(entry, target, 0, 30, undefined, mkNewId));
    expect(store.getSnapshot().timeline.tracks).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });

  it("no-op command (incompatible type) does not push to undo stack", () => {
    const track = makeTrack({ id: "t1", type: "audio", clips: [] });
    const tl = makeTimeline([track]);
    const store = new EditorStore(tl);
    const entry = makeEntry({ type: "video" });
    const target: TrackDropTarget = { kind: "existing", index: 0 };
    store.dispatch(addClipCommand(entry, target, 0, 30, undefined, mkNewId));
    expect(store.canUndo()).toBe(false);
  });
});

describe("trimClipCommand — duration clamp", () => {
  it("over-trimming the right edge clamps duration to >= 1 (never negative)", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const c = trimClipCommand("c1", "right", -99999).apply(tl).tracks[0]!.clips[0]!;
    expect(c.durationFrames).toBeGreaterThanOrEqual(1);
  });

  it("over-trimming the left edge clamps duration to >= 1 and keeps startFrame valid", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [clip] })]);
    const c = trimClipCommand("c1", "left", 99999).apply(tl).tracks[0]!.clips[0]!;
    expect(c.durationFrames).toBeGreaterThanOrEqual(1);
    expect(c.startFrame).toBeLessThan(30);
  });
});
