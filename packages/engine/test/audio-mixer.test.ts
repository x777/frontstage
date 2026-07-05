import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Clip } from "@frontstage/core";
import type { Timeline, Track } from "@frontstage/core";
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

// mp3/wav aren't ISO-BMFF — mp4box rejects them; the mixer must fall back to WebAudio's
// decodeAudioData instead of silently contributing silence (generated TTS/music are mp3).
describe("AudioMixer.create non-mp4 audio fallback", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.unstubAllGlobals();
  });

  it("decodes an mp3 via the WebAudio fallback when mp4 demux rejects", async () => {
    const { demuxMp4 } = await import("../src/demux/mp4-demuxer.js");
    (demuxMp4 as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not ISO-BMFF"));

    const fakeBuf = {
      numberOfChannels: 1,
      length: 4,
      sampleRate: 48000,
      getChannelData: () => new Float32Array([0.5, -0.5, 0.25, -0.25]),
    };
    vi.stubGlobal("OfflineAudioContext", class {
      constructor(_ch: number, _len: number, _rate: number) {}
      decodeAudioData = async () => fakeBuf;
    });

    const tl = timeline([track("a", "audio", [clip("c-mp3", "audio", { mediaRef: "mp3ref" })])]);
    const media = makeMedia(new Set(["mp3ref"]));

    const mixer = await AudioMixer.create(tl, media);

    expect(mixer).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    const win = mixer!.mixNext(tl, tl.fps);
    expect(Array.from(win!).some((v) => v !== 0)).toBe(true);
  });

  it("warns and skips when both mp4 demux and the fallback fail", async () => {
    const { demuxMp4 } = await import("../src/demux/mp4-demuxer.js");
    (demuxMp4 as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not ISO-BMFF"));
    vi.stubGlobal("OfflineAudioContext", class {
      constructor(_ch: number, _len: number, _rate: number) {}
      decodeAudioData = async () => { throw new Error("undecodable"); };
    });

    const tl = timeline([track("a", "audio", [clip("c-bad", "audio", { mediaRef: "badref" })])]);
    const media = makeMedia(new Set(["badref"]));

    const mixer = await AudioMixer.create(tl, media);

    expect(mixer).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("conforms a mono fallback to the established stereo mix format", async () => {
    const { demuxMp4 } = await import("../src/demux/mp4-demuxer.js");
    // first ref (mp4) demuxes as stereo 44100; second ref (mp3) rejects -> fallback
    (demuxMp4 as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        audio: {
          codec: "mock", sampleRate: 44100, channels: 2,
          samples: [{ cts: 0, byteOffset: 0, size: 4, isSync: true }],
          description: undefined,
        },
      })
      .mockRejectedValueOnce(new Error("not ISO-BMFF"));

    let requestedRate: number | undefined;
    let requestedCh: number | undefined;
    const fakeBuf = {
      numberOfChannels: 1,
      length: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array([0.5, -0.5]),
    };
    vi.stubGlobal("OfflineAudioContext", class {
      constructor(ch: number, _len: number, rate: number) { requestedCh = ch; requestedRate = rate; }
      decodeAudioData = async () => fakeBuf;
    });

    const tl = timeline([
      track("a", "audio", [
        clip("c-mp4", "audio", { mediaRef: "mp4ref" }),
        clip("c-mp3", "audio", { mediaRef: "mp3ref" }),
      ]),
    ]);
    const media = makeMedia(new Set(["mp4ref", "mp3ref"]));

    const mixer = await AudioMixer.create(tl, media);

    // decoded straight at the mix's established format — no heterogeneous-audio throw
    expect(mixer).toBeDefined();
    expect(requestedRate).toBe(44100);
    expect(requestedCh).toBe(2);
    expect(mixer!.channels).toBe(2);
    expect(mixer!.sampleRate).toBe(44100);
  });
});
