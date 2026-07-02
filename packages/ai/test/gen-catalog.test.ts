import { describe, expect, test } from "vitest";
import { genModel, listGenModels, validateGenParams } from "../src/generation/gen-catalog.js";
import type { GenModelEntry } from "../src/generation/gen-catalog.js";
import { estimateCredits, formatCredits } from "../src/generation/cost-estimator.js";

describe("gen-catalog: lookups", () => {
  test("genModel finds a known entry by id", () => {
    const entry = genModel("veo3.1-fast");
    expect(entry?.endpoint).toBe("fal-ai/veo3.1/fast");
    expect(entry?.kind).toBe("video");
  });

  test("genModel returns undefined for an unknown id", () => {
    expect(genModel("does-not-exist")).toBeUndefined();
  });

  test("listGenModels() returns all 9 curated entries", () => {
    expect(listGenModels()).toHaveLength(9);
  });

  test("listGenModels(kind) filters by kind", () => {
    expect(listGenModels("video").map((e) => e.id).sort()).toEqual(
      ["kling-2.5", "seedance-1.0", "veo3.1-fast"].sort(),
    );
    expect(listGenModels("image").map((e) => e.id).sort()).toEqual(["flux-dev", "nano-banana"].sort());
    expect(listGenModels("audio").map((e) => e.id).sort()).toEqual(["elevenlabs-tts", "minimax-music"].sort());
    expect(listGenModels("upscale").map((e) => e.id)).toEqual(["seedvr-upscale"]);
    expect(listGenModels("transcribe").map((e) => e.id)).toEqual(["wizper"]);
  });

  test("every entry has a non-empty id, endpoint, and displayName", () => {
    for (const entry of listGenModels()) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.endpoint.length).toBeGreaterThan(0);
      expect(entry.displayName.length).toBeGreaterThan(0);
    }
  });
});

describe("validateGenParams: naming allowed values", () => {
  test("rejects an unsupported duration, naming the allowed durations", () => {
    const entry = genModel("veo3.1-fast")!;
    const err = validateGenParams(entry, { prompt: "x", duration: 5, aspectRatio: "16:9", resolution: "720p" });
    expect(err).toBe("Veo 3.1 Fast does not support duration '5s'. Valid: 4s, 6s, 8s.");
  });

  test("rejects an unsupported aspect ratio, naming the allowed ratios", () => {
    const entry = genModel("veo3.1-fast")!;
    const err = validateGenParams(entry, { prompt: "x", duration: 8, aspectRatio: "1:1" });
    expect(err).toBe("Veo 3.1 Fast does not support aspect ratio '1:1'. Valid: 16:9, 9:16.");
  });

  test("rejects an unsupported resolution, naming the allowed resolutions", () => {
    const entry = genModel("seedance-1.0")!;
    const err = validateGenParams(entry, { prompt: "x", duration: 5, resolution: "4k" });
    expect(err).toBe("Seedance 1.0 Pro does not support resolution '4k'. Valid: 480p, 720p, 1080p.");
  });

  test("rejects an unsupported voice, naming the allowed voices", () => {
    const entry = genModel("elevenlabs-tts")!;
    const err = validateGenParams(entry, { prompt: "hi", voice: "Bogus" });
    expect(err).toContain("ElevenLabs TTS Turbo v2.5 does not support voice 'Bogus'. Valid: ");
    expect(err).toContain("Rachel");
  });

  test("rejects reference images over the model's cap", () => {
    const entry: GenModelEntry = {
      id: "fixture-refs",
      endpoint: "fal-ai/fixture",
      kind: "video",
      displayName: "Fixture Model",
      caps: { maxReferenceImages: 2 },
      pricing: { kind: "flat", credits: 1 },
      buildInput: () => ({}),
    };
    const err = validateGenParams(entry, { prompt: "x", imageUrls: ["a", "b", "c"] });
    expect(err).toBe("Fixture Model accepts at most 2 reference image(s) (got 3).");
  });

  test("rejects numImages over the model's cap, naming the range", () => {
    const entry = genModel("nano-banana")!;
    const err = validateGenParams(entry, { prompt: "x", numImages: 5 });
    expect(err).toBe("Nano Banana supports 1-4 image(s) per request (got 5).");
  });

  test("rejects audio params with neither prompt nor lyrics", () => {
    const tts = genModel("elevenlabs-tts")!;
    expect(validateGenParams(tts, {})).toBe("ElevenLabs TTS Turbo v2.5 requires a prompt.");

    const music = genModel("minimax-music")!;
    expect(validateGenParams(music, {})).toBe("MiniMax Music requires a prompt.");
  });

  test("accepts audio params with lyrics but no prompt (lyrics substitutes for prompt)", () => {
    const music = genModel("minimax-music")!;
    expect(validateGenParams(music, { lyrics: "la la la" })).toBeNull();
  });

  test("rejects video/image params missing a prompt", () => {
    const entry = genModel("veo3.1-fast")!;
    const err = validateGenParams(entry, { duration: 8, aspectRatio: "16:9" });
    expect(err).toBe("Veo 3.1 Fast requires a prompt.");
  });

  test("rejects upscale params missing a source URL", () => {
    const entry = genModel("seedvr-upscale")!;
    const err = validateGenParams(entry, { resolution: "1080p" });
    expect(err).toBe("SeedVR Upscale requires a source video URL.");
  });

  test("rejects transcribe params missing a source URL", () => {
    const entry = genModel("wizper")!;
    const err = validateGenParams(entry, { language: "en" });
    expect(err).toBe("Wizper (Whisper v3) requires a source audio URL.");
  });

  test("accepts transcribe params with a source URL (returns null)", () => {
    const entry = genModel("wizper")!;
    expect(validateGenParams(entry, { sourceUrl: "https://example.com/a.wav" })).toBeNull();
  });

  test("accepts a fully valid param set (returns null)", () => {
    const entry = genModel("veo3.1-fast")!;
    const err = validateGenParams(entry, { prompt: "x", duration: 8, aspectRatio: "16:9", resolution: "1080p" });
    expect(err).toBeNull();
  });
});

describe("estimateCredits: perSecond", () => {
  test("ceils a fractional per-second rate at a keyed resolution", () => {
    const entry = genModel("seedance-1.0")!;
    // 1080p rate is 12.4 credits/s; 3s * 12.4 = 37.2 -> ceil 38.
    expect(estimateCredits(entry, { duration: 3, resolution: "1080p" })).toBe(38);
  });

  test("falls back to the 'default' rate when no resolution is given", () => {
    const entry = genModel("kling-2.5")!;
    expect(estimateCredits(entry, { duration: 10 })).toBe(70);
  });

  test("falls back to the 'default' rate when the given resolution has no explicit rate", () => {
    const entry = genModel("veo3.1-fast")!;
    expect(estimateCredits(entry, { duration: 4, resolution: "unknown-res" })).toBe(60);
  });
});

describe("estimateCredits: perImage", () => {
  test("ceils numImages * the default per-image rate", () => {
    const entry = genModel("nano-banana")!;
    // 3 * 3.98 = 11.94 -> ceil 12.
    expect(estimateCredits(entry, { numImages: 3 })).toBe(12);
  });

  test("2D 'res|quality' lookup takes priority over 'default'", () => {
    const entry: GenModelEntry = {
      id: "fixture-2d",
      endpoint: "fal-ai/fixture",
      kind: "image",
      displayName: "Fixture 2D",
      caps: {},
      pricing: { kind: "perImage", creditsPerImage: { "1080p|high": 10, default: 5 } },
      buildInput: () => ({}),
    };
    expect(estimateCredits(entry, { resolution: "1080p", quality: "high", numImages: 2 })).toBe(20);
  });

  test("2D lookup falls back to 'default' when quality is missing", () => {
    const entry: GenModelEntry = {
      id: "fixture-2d",
      endpoint: "fal-ai/fixture",
      kind: "image",
      displayName: "Fixture 2D",
      caps: {},
      pricing: { kind: "perImage", creditsPerImage: { "1080p|high": 10, default: 5 } },
      buildInput: () => ({}),
    };
    expect(estimateCredits(entry, { resolution: "1080p", numImages: 2 })).toBe(10);
  });
});

describe("estimateCredits: audio + flat + upscale", () => {
  test("audioPerThousandChars sums prompt + lyrics length and ceils", () => {
    const entry = genModel("elevenlabs-tts")!;
    // 200 + 300 = 500 chars; 500/1000 * 5 = 2.5 -> ceil 3.
    expect(estimateCredits(entry, { prompt: "a".repeat(200), lyrics: "b".repeat(300) })).toBe(3);
  });

  test("flat pricing ceils the flat credit amount regardless of params", () => {
    const entry = genModel("minimax-music")!;
    expect(estimateCredits(entry, {})).toBe(4);
    expect(estimateCredits(entry, { lyrics: "la la la", duration: 30 })).toBe(4);
  });

  test("upscalePerSecond multiplies rate by source duration and ceils", () => {
    const entry = genModel("seedvr-upscale")!;
    expect(estimateCredits(entry, { duration: 10 })).toBe(50);
  });

  test("upscalePerSecond clamps duration to a minimum of 1 second", () => {
    const entry = genModel("seedvr-upscale")!;
    expect(estimateCredits(entry, {})).toBe(5);
  });

  test("wizper's audioPerSecond rate ceils the source duration", () => {
    const entry = genModel("wizper")!;
    // 0.01 cr/s * 130s = 1.3 -> ceil 2.
    expect(estimateCredits(entry, { duration: 130 })).toBe(2);
  });
});

describe("formatCredits", () => {
  test("formats 0 credits", () => {
    expect(formatCredits(0)).toBe("0 credits (~$0.00)");
  });

  test("formats 1 credit as singular", () => {
    expect(formatCredits(1)).toBe("1 credit (~$0.01)");
  });

  test("formats a two-digit credit amount", () => {
    expect(formatCredits(12)).toBe("12 credits (~$0.12)");
  });

  test("formats a larger credit amount over a dollar", () => {
    expect(formatCredits(150)).toBe("150 credits (~$1.50)");
  });
});

describe("buildInput: every entry maps normalized params to its fal body", () => {
  test("veo3.1-fast", () => {
    const entry = genModel("veo3.1-fast")!;
    expect(entry.buildInput({ prompt: "a cat", duration: 6, aspectRatio: "9:16", resolution: "1080p" })).toEqual({
      prompt: "a cat",
      duration: "6s",
      aspect_ratio: "9:16",
      resolution: "1080p",
      generate_audio: true,
    });
  });

  test("kling-2.5", () => {
    const entry = genModel("kling-2.5")!;
    expect(entry.buildInput({ prompt: "a dog", duration: 10, aspectRatio: "1:1" })).toEqual({
      prompt: "a dog",
      duration: "10",
      aspect_ratio: "1:1",
    });
  });

  test("seedance-1.0", () => {
    const entry = genModel("seedance-1.0")!;
    expect(entry.buildInput({ prompt: "a bird", duration: 8, aspectRatio: "4:3", resolution: "720p" })).toEqual({
      prompt: "a bird",
      duration: "8",
      aspect_ratio: "4:3",
      resolution: "720p",
    });
  });

  test("nano-banana", () => {
    const entry = genModel("nano-banana")!;
    expect(entry.buildInput({ prompt: "a fox", aspectRatio: "16:9", numImages: 2 })).toEqual({
      prompt: "a fox",
      aspect_ratio: "16:9",
      num_images: 2,
    });
  });

  test("flux-dev maps aspectRatio onto fal's image_size enum", () => {
    const entry = genModel("flux-dev")!;
    expect(entry.buildInput({ prompt: "a hill", aspectRatio: "16:9", numImages: 1 })).toEqual({
      prompt: "a hill",
      image_size: "landscape_16_9",
      num_images: 1,
    });
  });

  test("elevenlabs-tts", () => {
    const entry = genModel("elevenlabs-tts")!;
    expect(entry.buildInput({ prompt: "Hello there", voice: "Aria" })).toEqual({
      text: "Hello there",
      voice: "Aria",
    });
  });

  test("minimax-music with a reference audio URL", () => {
    const entry = genModel("minimax-music")!;
    expect(entry.buildInput({ lyrics: "la la la", sourceUrl: "https://example.com/ref.mp3" })).toEqual({
      prompt: "la la la",
      reference_audio_url: "https://example.com/ref.mp3",
    });
  });

  test("minimax-music without a reference audio URL omits the field", () => {
    const entry = genModel("minimax-music")!;
    expect(entry.buildInput({ lyrics: "la la la" })).toEqual({ prompt: "la la la" });
  });

  test("seedvr-upscale", () => {
    const entry = genModel("seedvr-upscale")!;
    expect(entry.buildInput({ sourceUrl: "https://example.com/video.mp4", resolution: "1440p" })).toEqual({
      video_url: "https://example.com/video.mp4",
      upscale_mode: "target",
      target_resolution: "1440p",
    });
  });

  test("wizper without a language override omits the field (auto-detect)", () => {
    const entry = genModel("wizper")!;
    expect(entry.buildInput({ sourceUrl: "https://example.com/a.wav" })).toEqual({
      audio_url: "https://example.com/a.wav",
      task: "transcribe",
      chunk_level: "segment",
      merge_chunks: false,
    });
  });

  test("wizper with a language override adds the field", () => {
    const entry = genModel("wizper")!;
    expect(entry.buildInput({ sourceUrl: "https://example.com/a.wav", language: "fr" })).toEqual({
      audio_url: "https://example.com/a.wav",
      task: "transcribe",
      chunk_level: "segment",
      merge_chunks: false,
      language: "fr",
    });
  });
});
