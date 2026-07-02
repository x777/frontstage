import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import { captionSpecsForClip, dominantSpeechTrack } from "./caption-mapper.js";
import type { CaptionPhrase } from "./caption-builder.js";
import type { TranscriptionResult } from "../media/transcript.js";

function makeClip(overrides: Partial<Clip> & { id: string }): Clip {
  return {
    mediaRef: "m1",
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
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    ...overrides,
  };
}

function phrase(overrides: Partial<CaptionPhrase>): CaptionPhrase {
  return { text: "phrase", startSec: 0, endSec: 1, words: [], ...overrides };
}

describe("captionSpecsForClip — frame math", () => {
  it("maps source-seconds to timeline frames with no trim/speed", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 90 }); // 3s @ 30fps
    const specs = captionSpecsForClip(
      clip,
      0,
      [phrase({ text: "hi", startSec: 1, endSec: 2, words: [{ text: "hi", startSec: 1, endSec: 2 }] })],
      30,
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]).toEqual({
      content: "hi",
      startFrame: 30,
      durationFrames: 30,
      wordTimings: [{ text: "hi", startFrame: 0, endFrame: 30 }],
    });
  });

  it("maps through trim and speed like clipTimelineFrame", () => {
    // trimStart 15 frames (0.5s), speed 2x, so 30 timeline frames covers 60 source frames (2s):
    // visible source window is [0.5s, 2.5s).
    const clip = makeClip({ id: "c1", startFrame: 100, durationFrames: 30, trimStartFrame: 15, speed: 2 });
    // minDisplaySec 0 disables the floor so this isolates the trim/speed math.
    const specs = captionSpecsForClip(clip, 0, [phrase({ startSec: 1, endSec: 1.5 })], 30, 0);
    expect(specs).toHaveLength(1);
    // source frame 30 -> offset 15 -> 100 + 15/2 = 107.5 -> rounds to 108
    // source frame 45 -> offset 30 -> 100 + 30/2 = 115
    expect(specs[0]!.startFrame).toBe(108);
    expect(specs[0]!.durationFrames).toBe(7);
  });

  it("clamps a phrase starting before the clip's trim to the clip's own start", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 90 });
    // phraseStart (0s) is before the visible window's mapped start; overlaps [0, 2s)
    const specs = captionSpecsForClip(clip, 0, [phrase({ startSec: -1, endSec: 1 })], 30);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.startFrame).toBe(clip.startFrame);
  });

  it("drops a phrase that never overlaps the clip's visible window", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30 }); // 1s window
    const specs = captionSpecsForClip(clip, 0, [phrase({ startSec: 5, endSec: 6 })], 30);
    expect(specs).toHaveLength(0);
  });

  it("drops individual words outside the visible window but keeps the overlapping phrase", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 30 }); // 1s window [0,1)
    const specs = captionSpecsForClip(
      clip,
      0,
      [
        phrase({
          text: "in and out",
          startSec: 0.5,
          endSec: 1.5,
          words: [
            { text: "in", startSec: 0.5, endSec: 0.8 }, // inside
            { text: "out", startSec: 1.2, endSec: 1.5 }, // fully outside [0,1)
          ],
        }),
      ],
      30,
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]!.wordTimings).toHaveLength(1);
    expect(specs[0]!.wordTimings[0]!.text).toBe("in");
  });
});

describe("captionSpecsForClip — 0.7s minimum display floor", () => {
  it("extends a short phrase but never past the next phrase's start", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 100 }); // 10s @ 10fps
    const phrases = [phrase({ text: "short", startSec: 1, endSec: 1.2 }), phrase({ text: "next", startSec: 1.3, endSec: 2 })];
    const specs = captionSpecsForClip(clip, 0, phrases, 10, 0.7);
    expect(specs).toHaveLength(2);
    // floored end = min(1 + 0.7, 1.3) = 1.3 -> frames [10, 13)
    expect(specs[0]).toMatchObject({ startFrame: 10, durationFrames: 3 });
    // next phrase starts exactly where the floored phrase ends
    expect(specs[1]!.startFrame).toBe(13);
  });

  it("lets the last phrase extend freely, then clamps it to the clip's own end", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 100 }); // 10s @ 10fps
    const specs = captionSpecsForClip(clip, 0, [phrase({ text: "last", startSec: 9.5, endSec: 9.6 })], 10, 0.7);
    expect(specs).toHaveLength(1);
    // floored end would be 10.2s (past the clip's 10s end) -> clamped to the clip's end frame (100)
    expect(specs[0]!.startFrame).toBe(95);
    expect(specs[0]!.durationFrames).toBe(5);
  });

  it("does not shrink a phrase that already meets the floor", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 100 });
    const specs = captionSpecsForClip(clip, 0, [phrase({ startSec: 1, endSec: 3 })], 10, 0.7);
    expect(specs[0]!.durationFrames).toBe(20);
  });
});

function transcript(words: TranscriptionResult["words"]): TranscriptionResult {
  return { text: "", words, segments: [] };
}

describe("dominantSpeechTrack", () => {
  it("picks the track whose clips contain the most spoken-word midpoints", () => {
    const clipA = makeClip({ id: "a", mediaRef: "a", durationFrames: 100 });
    const clipB = makeClip({ id: "b", mediaRef: "b", durationFrames: 100 });
    const transcripts = new Map<string, TranscriptionResult>([
      ["a", transcript([{ text: "w", start: 1, end: 2 }, { text: "w", start: 3, end: 4 }, { text: "w", start: 5, end: 6 }])],
      ["b", transcript([{ text: "w", start: 1, end: 2 }])],
    ]);
    const winner = dominantSpeechTrack(
      [
        { clip: clipA, trackIndex: 0 },
        { clip: clipB, trackIndex: 1 },
      ],
      transcripts,
      10,
    );
    expect(winner).toBe(0);
  });

  it("breaks a tie in favor of the lower trackIndex (Swift's dictionary order is unspecified)", () => {
    const clipA = makeClip({ id: "a", mediaRef: "a", durationFrames: 100 });
    const clipB = makeClip({ id: "b", mediaRef: "b", durationFrames: 100 });
    const transcripts = new Map<string, TranscriptionResult>([
      ["a", transcript([{ text: "w", start: 1, end: 2 }, { text: "w", start: 3, end: 4 }])],
      ["b", transcript([{ text: "w", start: 1, end: 2 }, { text: "w", start: 3, end: 4 }])],
    ]);
    const winner = dominantSpeechTrack(
      [
        { clip: clipA, trackIndex: 2 },
        { clip: clipB, trackIndex: 0 },
      ],
      transcripts,
      10,
    );
    expect(winner).toBe(0);
  });

  it("ignores a target whose mediaRef has no transcript", () => {
    const clipA = makeClip({ id: "a", mediaRef: "a", durationFrames: 100 });
    const clipC = makeClip({ id: "c", mediaRef: "missing", durationFrames: 100 });
    const transcripts = new Map<string, TranscriptionResult>([["a", transcript([{ text: "w", start: 1, end: 2 }])]]);
    const winner = dominantSpeechTrack(
      [
        { clip: clipA, trackIndex: 0 },
        { clip: clipC, trackIndex: 1 },
      ],
      transcripts,
      10,
    );
    expect(winner).toBe(0);
  });

  it("returns null when no track has any spoken words inside its visible window", () => {
    const clipA = makeClip({ id: "a", mediaRef: "a", durationFrames: 10 }); // 1s window
    const transcripts = new Map<string, TranscriptionResult>([
      ["a", transcript([{ text: "w", start: 5, end: 6 }])], // well outside the 1s window
    ]);
    const winner = dominantSpeechTrack([{ clip: clipA, trackIndex: 0 }], transcripts, 10);
    expect(winner).toBeNull();
  });

  it("counts a word by its midpoint: inclusive of the window start, exclusive of the window end", () => {
    const clip = makeClip({ id: "a", mediaRef: "a", durationFrames: 100 }); // 10s window @ 10fps -> [0,10)
    const transcripts = new Map<string, TranscriptionResult>([
      [
        "a",
        transcript([
          { text: "startEdge", start: -0.05, end: 0.05 }, // mid 0.0 -> included (>= start)
          { text: "endEdge", start: 9.95, end: 10.05 }, // mid 10.0 -> excluded (not < end)
        ]),
      ],
    ]);
    const winner = dominantSpeechTrack([{ clip, trackIndex: 7 }], transcripts, 10);
    expect(winner).toBe(7);
  });
});
