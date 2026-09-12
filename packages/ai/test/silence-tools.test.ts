import { describe, expect, test } from "vitest";
import {
  EditorStore,
  WAVEFORM_SAMPLES_PER_SECOND,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  type Clip,
  type Timeline,
  type Track,
} from "@frontstage/core";
import { removeSilenceTool } from "../src/tools/silence-tools.js";
import type { ToolContext } from "../src/index.js";

function clip(over: Partial<Clip> & { id: string; mediaType: Clip["mediaType"] }): Clip {
  return {
    mediaRef: "m1",
    sourceClipType: over.mediaType,
    startFrame: 0,
    durationFrames: 80,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    ...over,
  };
}

function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  const block = result.blocks[0];
  return block?.kind === "text" ? (block.text ?? "") : "";
}

describe("remove_silence tool", () => {
  test("one undo restores linked A/V after cutting quiet non-speech", async () => {
    const quiet = [...Array(50).fill(false), ...Array(50).fill(true), ...Array(150).fill(false)];
    const tl: Timeline = {
      ...defaultTimeline(),
      fps: 10,
      tracks: [
        track("v", "video", [clip({ id: "v1", mediaType: "video", linkGroupId: "g" })]),
        track("a", "audio", [clip({ id: "a1", mediaType: "audio", linkGroupId: "g" })]),
      ],
    };
    const store = new EditorStore(tl);
    const before = store.getSnapshot().timeline;
    const ctx: ToolContext = {
      store,
      getManifest: () => ({ version: 2, entries: [], folders: [] }),
      newId: () => "x",
      audioAnalysis: {
        waveformSamples: () => undefined,
        quietNonSpeechMask: () => quiet,
      },
    };

    const result = await removeSilenceTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const payload = JSON.parse(textOf(result));
    expect(payload.sectionsRemoved).toBeGreaterThan(0);
    expect(payload.removedFrames).toBeGreaterThan(0);

    const audioDur = store.getSnapshot().timeline.tracks[1]!.clips.reduce((s, c) => s + c.durationFrames, 0);
    const videoDur = store.getSnapshot().timeline.tracks[0]!.clips.reduce((s, c) => s + c.durationFrames, 0);
    expect(audioDur).toBeLessThan(80);
    expect(videoDur).toBe(audioDur);

    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips.map((c) => c.durationFrames)).toEqual(
      before.tracks[0]!.clips.map((c) => c.durationFrames),
    );
    expect(store.getSnapshot().timeline.tracks[1]!.clips.map((c) => c.durationFrames)).toEqual(
      before.tracks[1]!.clips.map((c) => c.durationFrames),
    );
  });

  test("waveformSamples at 200 Hz remove real seconds, not VAD-stretched cells", async () => {
    const fps = 10;
    const durationSeconds = 8;
    const durationFrames = fps * durationSeconds;
    const loud1s = Array(1 * WAVEFORM_SAMPLES_PER_SECOND).fill(0);
    const quiet2s = Array(2 * WAVEFORM_SAMPLES_PER_SECOND).fill(1);
    const loud5s = Array(5 * WAVEFORM_SAMPLES_PER_SECOND).fill(0);
    const samples = [...loud1s, ...quiet2s, ...loud5s];
    expect(samples.length).toBe(durationSeconds * WAVEFORM_SAMPLES_PER_SECOND);

    const tl: Timeline = {
      ...defaultTimeline(),
      fps,
      tracks: [
        track("v", "video", [clip({ id: "v1", mediaType: "video", linkGroupId: "g", durationFrames })]),
        track("a", "audio", [clip({ id: "a1", mediaType: "audio", linkGroupId: "g", durationFrames })]),
      ],
    };
    const store = new EditorStore(tl);
    const ctx: ToolContext = {
      store,
      getManifest: () => ({ version: 2, entries: [], folders: [] }),
      newId: () => "x",
      audioAnalysis: {
        waveformSamples: (mediaRef) => (mediaRef === "m1" ? samples : undefined),
        quietNonSpeechMask: () => undefined,
      },
    };

    const result = await removeSilenceTool().run(
      { minimumPauseSeconds: 0.5, speechPaddingSeconds: 0.15 },
      ctx,
    );
    expect(result.isError).toBe(false);
    const payload = JSON.parse(textOf(result)) as { sectionsRemoved: number; removedFrames: number };
    expect(payload.sectionsRemoved).toBeGreaterThan(0);

    // 2 s gap minus 0.15 s speech padding on each side = 1.7 s. VAD cells are 32 ms,
    // so allow a small quantization window. The 6.4× stretch bug either cuts nothing
    // (gap sits past the visible 8 s window) or removes ~6× too many frames.
    const expectedSeconds = 2 - 2 * 0.15;
    const removedSeconds = payload.removedFrames / fps;
    expect(removedSeconds).toBeGreaterThan(expectedSeconds - 0.4);
    expect(removedSeconds).toBeLessThan(expectedSeconds + 0.4);

    const audioDur = store.getSnapshot().timeline.tracks[1]!.clips.reduce((s, c) => s + c.durationFrames, 0);
    const videoDur = store.getSnapshot().timeline.tracks[0]!.clips.reduce((s, c) => s + c.durationFrames, 0);
    expect(audioDur).toBe(durationFrames - payload.removedFrames);
    expect(videoDur).toBe(audioDur);
  });

  test("0.4 s quiet at 200 Hz is below the default 0.5 s min-pause", async () => {
    const fps = 10;
    const durationSeconds = 2;
    const durationFrames = fps * durationSeconds;
    const samples = [
      ...Array(0.4 * WAVEFORM_SAMPLES_PER_SECOND).fill(1),
      ...Array(1.6 * WAVEFORM_SAMPLES_PER_SECOND).fill(0),
    ];
    const store = new EditorStore({
      ...defaultTimeline(),
      fps,
      tracks: [track("a", "audio", [clip({ id: "a1", mediaType: "audio", durationFrames })])],
    });
    const ctx: ToolContext = {
      store,
      getManifest: () => ({ version: 2, entries: [], folders: [] }),
      newId: () => "x",
      audioAnalysis: {
        waveformSamples: () => samples,
        quietNonSpeechMask: () => undefined,
      },
    };
    const result = await removeSilenceTool().run(
      { minimumPauseSeconds: 0.5, speechPaddingSeconds: 0 },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No dead air/);
  });

  test("reports no dead air when analysis is missing", async () => {
    const store = new EditorStore({
      ...defaultTimeline(),
      tracks: [track("a", "audio", [clip({ id: "a1", mediaType: "audio" })])],
    });
    const ctx: ToolContext = {
      store,
      getManifest: () => ({ version: 2, entries: [], folders: [] }),
      newId: () => "x",
    };
    const result = await removeSilenceTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No dead air/);
  });
});
