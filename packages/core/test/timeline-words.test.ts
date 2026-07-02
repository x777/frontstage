import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import { defaultTimeline } from "../src/timeline.js";
import type { Timeline, Track } from "../src/timeline.js";
import type { TranscriptionResult } from "../src/media/transcript.js";
import {
  assembleTimelineWords, clipTimelineWords, transcriptTargets, type TimelineWord,
} from "../src/media/timeline-words.js";

function baseClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c", mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame: 0, durationFrames: 100, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(), ...over,
  };
}

function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function timelineOf(...tracks: Track[]): Timeline {
  return { ...defaultTimeline(), tracks };
}

describe("transcriptTargets", () => {
  test("includes both audio and video clips", () => {
    const timeline = timelineOf(
      track("t0", "video", [baseClip({ id: "v1" })]),
      track("t1", "audio", [baseClip({ id: "a1", mediaType: "audio", sourceClipType: "audio" })]),
    );
    expect(transcriptTargets(timeline).map((t) => t.clip.id)).toEqual(["v1", "a1"]);
  });

  test("drops a video clip whose linked audio clip is also present (dedupe)", () => {
    const timeline = timelineOf(
      track("t0", "video", [baseClip({ id: "v1", linkGroupId: "g1" })]),
      track("t1", "audio", [
        baseClip({ id: "a1", mediaType: "audio", sourceClipType: "audio", linkGroupId: "g1" }),
      ]),
    );
    const targets = transcriptTargets(timeline);
    expect(targets.map((t) => t.clip.id)).toEqual(["a1"]);
    expect(targets[0]!.trackIndex).toBe(1);
  });

  test("keeps an unlinked video clip", () => {
    const timeline = timelineOf(track("t0", "video", [baseClip({ id: "v1" })]));
    expect(transcriptTargets(timeline).map((t) => t.clip.id)).toEqual(["v1"]);
  });

  test("keeps a linked video clip when no audio clip shares its linkGroupId", () => {
    const timeline = timelineOf(track("t0", "video", [baseClip({ id: "v1", linkGroupId: "g1" })]));
    expect(transcriptTargets(timeline).map((t) => t.clip.id)).toEqual(["v1"]);
  });

  test("ignores non audio/video clips", () => {
    const timeline = timelineOf(
      track("t0", "video", [baseClip({ id: "txt", mediaType: "text", sourceClipType: "text" })]),
    );
    expect(transcriptTargets(timeline)).toEqual([]);
  });

  test("sorts targets by clip startFrame", () => {
    const timeline = timelineOf(
      track("t0", "video", [baseClip({ id: "late", startFrame: 50 }), baseClip({ id: "early", startFrame: 0 })]),
    );
    expect(transcriptTargets(timeline).map((t) => t.clip.id)).toEqual(["early", "late"]);
  });
});

const fps = 30;

function transcriptOf(words: TranscriptionResult["words"]): TranscriptionResult {
  return { text: "", words, segments: [] };
}

describe("clipTimelineWords", () => {
  test("maps a word inside the window via start + ((s*fps)-trim)/speed", () => {
    const clip = baseClip({ startFrame: 100, durationFrames: 60, trimStartFrame: 0, speed: 1 });
    const words = clipTimelineWords(clip, 2, transcriptOf([{ text: "hi", start: 1, end: 1.5 }]), fps);
    // start(100) + ((1*30)-0)/1 = 130
    expect(words).toEqual([{ text: "hi", startFrame: 130, endFrame: 145, clipId: "c", trackIndex: 2 }]);
  });

  test("drops a word trimmed away before the visible window", () => {
    const clip = baseClip({ startFrame: 100, durationFrames: 50, trimStartFrame: 15, speed: 1 });
    // 0.2s * 30fps = 6 frames < trimStartFrame(15) -> offsetFromTrim negative -> dropped
    const words = clipTimelineWords(clip, 0, transcriptOf([{ text: "gone", start: 0.2, end: 0.4 }]), fps);
    expect(words).toEqual([]);
  });

  test("halves deltas for a 2x speed clip", () => {
    const clip = baseClip({ startFrame: 100, durationFrames: 50, trimStartFrame: 0, speed: 2 });
    const words = clipTimelineWords(clip, 0, transcriptOf([{ text: "hi", start: 1, end: 2 }]), fps);
    // start(100) + (30-0)/2 = 115; end(100) + (60-0)/2 = 130 -> 15-frame span for a 30-frame source delta
    expect(words).toEqual([{ text: "hi", startFrame: 115, endFrame: 130, clipId: "c", trackIndex: 0 }]);
  });

  test("drops words missing timestamps", () => {
    const clip = baseClip({ startFrame: 0, durationFrames: 60 });
    const words = clipTimelineWords(clip, 0, transcriptOf([{ text: "um" }]), fps);
    expect(words).toEqual([]);
  });

  test("clamps a word's end frame to clipEndFrame instead of dropping it", () => {
    const clip = baseClip({ startFrame: 100, durationFrames: 50, trimStartFrame: 0, speed: 1 });
    // start=1s -> frame 130 (in range); end=3s -> frame 190, past clipEndFrame(150) -> clamp
    const words = clipTimelineWords(clip, 0, transcriptOf([{ text: "hi", start: 1, end: 3 }]), fps);
    expect(words).toEqual([{ text: "hi", startFrame: 130, endFrame: 150, clipId: "c", trackIndex: 0 }]);
  });

  test("carries the speaker field through", () => {
    const clip = baseClip({ startFrame: 0, durationFrames: 60 });
    const words = clipTimelineWords(
      clip, 0, transcriptOf([{ text: "hi", start: 0, end: 0.5, speaker: "S1" }]), fps,
    );
    expect(words[0]!.speaker).toBe("S1");
  });
});

describe("assembleTimelineWords", () => {
  test("assigns stable sequential indices in per-clip block order", () => {
    const a: Omit<TimelineWord, "index">[] = [
      { text: "a1", startFrame: 0, endFrame: 10, clipId: "A", trackIndex: 0 },
      { text: "a2", startFrame: 50, endFrame: 60, clipId: "A", trackIndex: 0 },
    ];
    const b: Omit<TimelineWord, "index">[] = [
      { text: "b1", startFrame: 10, endFrame: 20, clipId: "B", trackIndex: 1 },
    ];
    // b's word (frame 10) falls chronologically between a's two words, but clip A's block
    // (leading word at frame 0) sorts before clip B's block (leading word at frame 10) and stays
    // contiguous — matching Swift's per-clip concatenation that later grouping-by-clipId relies on.
    const words = assembleTimelineWords([b, a]);
    expect(words.map((w) => w.text)).toEqual(["a1", "a2", "b1"]);
    expect(words.map((w) => w.index)).toEqual([0, 1, 2]);
  });

  test("breaks a same-startFrame tie by trackIndex", () => {
    const a: Omit<TimelineWord, "index">[] = [{ text: "a1", startFrame: 0, endFrame: 10, clipId: "A", trackIndex: 1 }];
    const b: Omit<TimelineWord, "index">[] = [{ text: "b1", startFrame: 0, endFrame: 10, clipId: "B", trackIndex: 0 }];
    expect(assembleTimelineWords([a, b]).map((w) => w.clipId)).toEqual(["B", "A"]);
  });

  test("skips clips with no mapped words without breaking ordering", () => {
    const words = assembleTimelineWords([
      [],
      [{ text: "a1", startFrame: 5, endFrame: 10, clipId: "A", trackIndex: 0 }],
    ]);
    expect(words).toEqual([{ text: "a1", startFrame: 5, endFrame: 10, clipId: "A", trackIndex: 0, index: 0 }]);
  });
});
