import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Track } from "../timeline.js";
import type { Timeline } from "../timeline.js";
import { EditorStore } from "./editor-store.js";
import { splitAtPlayheadCommand, trimStartToPlayheadCommand, trimEndToPlayheadCommand } from "./playhead-commands.js";

// --- Test fixture helpers (mirrors timeline-commands.test.ts) ---

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

// Deterministic id generator for split right-halves (avoid relying on global crypto in tests).
function idGen(prefix = "gen"): () => string {
  let i = 0;
  return () => `${prefix}-${i++}`;
}

// --- splitAtPlayheadCommand ---

describe("splitAtPlayheadCommand", () => {
  it("splits every selected clip strictly containing the frame, one dispatch = one undo", () => {
    const a = makeClip({ id: "a", startFrame: 20, durationFrames: 20 }); // 20..40
    const b = makeClip({ id: "b", startFrame: 10, durationFrames: 40 }); // 10..50
    const tl = makeTimeline([
      makeTrack({ id: "t1", clips: [a] }),
      makeTrack({ id: "t2", clips: [b] }),
    ]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;

    store.dispatch(splitAtPlayheadCommand(["a", "b"], 30, idGen()));

    const clips = store.getSnapshot().timeline.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(4);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });

  it("linked partners split too", () => {
    const v = makeClip({ id: "v", startFrame: 0, durationFrames: 40, mediaType: "video", linkGroupId: "g1" });
    const a = makeClip({ id: "a", startFrame: 0, durationFrames: 40, mediaType: "audio", linkGroupId: "g1" });
    const tl = makeTimeline([
      makeTrack({ id: "vt", type: "video", clips: [v] }),
      makeTrack({ id: "at", type: "audio", clips: [a] }),
    ]);
    const store = new EditorStore(tl);

    // Only the video clip is selected — the linked audio partner must still split.
    store.dispatch(splitAtPlayheadCommand(["v"], 20, idGen()));

    const videoClips = store.getSnapshot().timeline.tracks[0]!.clips;
    const audioClips = store.getSnapshot().timeline.tracks[1]!.clips;
    expect(videoClips).toHaveLength(2);
    expect(audioClips).toHaveLength(2);
  });

  it("skips clips where frame is at/outside edges; all-skip -> timeline unchanged -> NO undo entry", () => {
    const a = makeClip({ id: "a", startFrame: 10, durationFrames: 20 }); // 10..30 — frame===endFrame(a)
    const b = makeClip({ id: "b", startFrame: 30, durationFrames: 20 }); // 30..50 — frame===startFrame(b)
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [a, b] })]);
    const store = new EditorStore(tl);

    store.dispatch(splitAtPlayheadCommand(["a", "b"], 30, idGen()));

    expect(store.canUndo()).toBe(false);
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(2);
  });
});

// --- trimStartToPlayheadCommand ---

describe("trimStartToPlayheadCommand", () => {
  it("moves start to frame with speed-aware source delta", () => {
    const c = makeClip({ id: "c1", startFrame: 0, durationFrames: 60, speed: 2, trimStartFrame: 0 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [c] })]);
    const store = new EditorStore(tl);

    store.dispatch(trimStartToPlayheadCommand(["c1"], 20));

    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(clip.startFrame).toBe(20);
    expect(clip.durationFrames).toBe(40);
    expect(clip.trimStartFrame).toBe(40);
  });

  it("skips when frame outside (start<frame<end violated); unchanged -> no undo entry", () => {
    const c = makeClip({ id: "c1", startFrame: 10, durationFrames: 20 }); // 10..30
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [c] })]);
    const store = new EditorStore(tl);

    store.dispatch(trimStartToPlayheadCommand(["c1"], 10)); // frame === startFrame
    expect(store.canUndo()).toBe(false);

    store.dispatch(trimStartToPlayheadCommand(["c1"], 30)); // frame === endFrame
    expect(store.canUndo()).toBe(false);
  });

  it("does NOT touch linked partners", () => {
    const v = makeClip({ id: "v", startFrame: 0, durationFrames: 60, mediaType: "video", linkGroupId: "g1" });
    const a = makeClip({ id: "a", startFrame: 0, durationFrames: 60, mediaType: "audio", linkGroupId: "g1" });
    const tl = makeTimeline([
      makeTrack({ id: "vt", type: "video", clips: [v] }),
      makeTrack({ id: "at", type: "audio", clips: [a] }),
    ]);
    const store = new EditorStore(tl);

    store.dispatch(trimStartToPlayheadCommand(["v"], 20));

    const videoClip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    const audioClip = store.getSnapshot().timeline.tracks[1]!.clips[0]!;
    expect(videoClip.startFrame).toBe(20);
    expect(audioClip.startFrame).toBe(0);
    expect(audioClip.durationFrames).toBe(60);
  });
});

// --- trimEndToPlayheadCommand ---

describe("trimEndToPlayheadCommand", () => {
  it("moves end to frame with speed-aware source delta", () => {
    const c = makeClip({ id: "c1", startFrame: 0, durationFrames: 60, speed: 2, trimEndFrame: 0 });
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [c] })]);
    const store = new EditorStore(tl);

    store.dispatch(trimEndToPlayheadCommand(["c1"], 40));

    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(clip.durationFrames).toBe(40);
    expect(clip.trimEndFrame).toBe(40);
  });

  it("skips when frame outside", () => {
    const c = makeClip({ id: "c1", startFrame: 10, durationFrames: 20 }); // 10..30
    const tl = makeTimeline([makeTrack({ id: "t1", clips: [c] })]);
    const store = new EditorStore(tl);

    store.dispatch(trimEndToPlayheadCommand(["c1"], 10)); // frame === startFrame
    expect(store.canUndo()).toBe(false);

    store.dispatch(trimEndToPlayheadCommand(["c1"], 30)); // frame === endFrame
    expect(store.canUndo()).toBe(false);
  });
});
