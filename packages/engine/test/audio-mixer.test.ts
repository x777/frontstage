import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Clip } from "@palmier/core";
import type { Timeline, Track } from "@palmier/core";
import type { MediaByteSource } from "../src/media/media-source.js";
import { audioMixClips, AudioMixer } from "../src/audio/audio-mixer.js";

// AudioMixer.create() demuxes + decodes real audio via WebCodecs' AudioDecoder, which doesn't
// exist in Node. Stub the demux/decode boundary (same approach source-coordinator.test.ts uses
// for ImageSource) so the per-clip missing-media tolerance under test runs without real decode.
vi.mock("../src/demux/mp4-demuxer.js", () => ({
  demuxMp4: vi.fn(async () => ({
    audio: {
      codec: "mock", sampleRate: 48000, channels: 1,
      samples: [{ cts: 0, byteOffset: 0, size: 4, isSync: true }],
      description: undefined,
    },
  })),
}));
vi.mock("../src/decode/audio-decoder.js", () => ({
  buildAudioChunks: vi.fn(() => []),
  AudioDecodeManager: {
    create: vi.fn(async () => ({
      decodeAll: async (onPcm: (pcm: { data: Float32Array }) => void) => {
        onPcm({ data: new Float32Array([0.5, -0.5, 0.25, -0.25]) });
      },
    })),
  },
}));

function clip(id: string, mediaType: Clip["mediaType"], overrides: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType, sourceClipType: mediaType,
    startFrame: 0, durationFrames: 30, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    ...overrides,
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

function makeMedia(openableRefs: Set<string>): MediaByteSource {
  return {
    open: vi.fn(async (ref: string) => {
      if (!openableRefs.has(ref)) throw new Error(`missing media: ${ref}`);
      return new Blob([new Uint8Array([1, 2, 3, 4])]);
    }),
  };
}

describe("AudioMixer.create missing-media tolerance", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("skips a clip whose media.open rejects and mixes the rest", async () => {
    const tl = timeline([
      track("a", "audio", [
        clip("c-ok", "audio", { mediaRef: "ok" }),
        clip("c-missing", "audio", { mediaRef: "missing" }),
      ]),
    ]);
    const media = makeMedia(new Set(["ok"]));

    const mixer = await AudioMixer.create(tl, media);

    expect(mixer).toBeDefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain("missing");

    const win = mixer!.mixNext(tl, tl.fps);
    expect(win).toBeDefined();
    // the healthy clip's decoded PCM should be present (non-silent) in the mixed output
    expect(Array.from(win!).some((v) => v !== 0)).toBe(true);
  });

  it("warns once per failing ref even when multiple clips share it", async () => {
    const tl = timeline([
      track("a", "audio", [
        clip("c1", "audio", { mediaRef: "missing" }),
        clip("c2", "audio", { mediaRef: "missing" }),
      ]),
    ]);
    const media = makeMedia(new Set());

    const mixer = await AudioMixer.create(tl, media);

    expect(mixer).toBeUndefined(); // no clip contributed a usable source
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does not change behavior when all media opens fine", async () => {
    const tl = timeline([
      track("a", "audio", [clip("c1", "audio", { mediaRef: "a" }), clip("c2", "audio", { mediaRef: "b" })]),
    ]);
    const media = makeMedia(new Set(["a", "b"]));

    const mixer = await AudioMixer.create(tl, media);

    expect(mixer).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
