import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop } from "@palmier/core";
import type { MediaManifest, MediaManifestEntry, Timeline, Track } from "@palmier/core";
import { generateVideoTool, upscaleMediaTool, generateAudioTool, listModelsTool } from "../src/tools/generate-tools.js";
import type { ToolContext } from "../src/index.js";
import type { StartJobArgs } from "../src/generation/generation-service.js";

type GenerationFacade = NonNullable<ToolContext["generation"]>;

function makeFacade(overrides?: Partial<GenerationFacade>): {
  facade: GenerationFacade;
  addPlaceholderCalls: MediaManifestEntry[];
  startJobCalls: StartJobArgs[];
} {
  const addPlaceholderCalls: MediaManifestEntry[] = [];
  const startJobCalls: StartJobArgs[] = [];
  const facade: GenerationFacade = {
    hasKey: async () => true,
    addPlaceholder: (entry) => { addPlaceholderCalls.push(entry); },
    startJob: async (args) => { startJobCalls.push(args); return { jobId: "job-1" }; },
    confirmThreshold: 50,
    ...overrides,
  };
  return { facade, addPlaceholderCalls, startJobCalls };
}

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  const store = new EditorStore(defaultTimeline());
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => "new-id",
    ...overrides,
  };
}

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  const block = result.blocks[0];
  return block?.kind === "text" ? (block.text ?? "") : "";
}

// ── generate_video ──────────────────────────────────────────────────────────

describe("generate_video tool", () => {
  test("has the correct name", () => {
    expect(generateVideoTool().name).toBe("generate_video");
  });

  test("errors when ctx.generation is absent", async () => {
    const tool = generateVideoTool();
    const ctx = makeCtx();

    const result = await tool.run({ prompt: "a cat", model: "veo3.1-fast" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not available");
  });

  test("errors when no fal key is configured, pointing at settings", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade({ hasKey: async () => false });
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat", model: "veo3.1-fast" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Settings");
  });

  test("errors on an unknown model, mentioning list_models", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat", model: "does-not-exist" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("list_models");
  });

  test("errors when the model is not a video-kind model", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat", model: "nano-banana" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("list_models");
  });

  test("errors on an invalid duration, naming the allowed values", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 999, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Veo 3.1 Fast does not support duration '999s'. Valid: 4s, 6s, 8s.");
  });

  test("an OMITTED duration is priced at the model's default — the gate cannot be bypassed", async () => {
    const tool = generateVideoTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    // veo3.1-fast default duration = caps.durations[0] = 4s × 15 = 60 credits > 50 threshold.
    // Before the fix this estimated 0 (undefined duration) and submitted without confirmation.
    const result = await tool.run({ prompt: "a cat", model: "veo3.1-fast" }, ctx);

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Confirmation required");
    expect(textOf(result)).toContain("60 credits");
    expect(addPlaceholderCalls).toHaveLength(0);
    expect(startJobCalls).toHaveLength(0);

    // Confirmed: the recorded cost is the real default-duration estimate, not 0.
    const confirmed = await tool.run({ prompt: "a cat", model: "veo3.1-fast", confirm: true }, ctx);
    expect(confirmed.isError).toBe(false);
    expect(startJobCalls).toHaveLength(1);
    expect(startJobCalls[0]!.costCredits).toBe(60);
    expect(startJobCalls[0]!.placeholders[0]!.duration).toBe(4);
  });

  test("over threshold without confirm returns a non-error confirmation and does not submit", async () => {
    const tool = generateVideoTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    // veo3.1-fast @ 1080p * 8s = 15 * 8 = 120 credits, over the 50-credit threshold.
    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 8, resolution: "1080p" },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Confirmation required");
    expect(textOf(result)).toContain("120 credits");
    expect(textOf(result)).toContain("confirm: true");
    expect(addPlaceholderCalls).toHaveLength(0);
    expect(startJobCalls).toHaveLength(0);
  });

  test("with confirm: true, adds a placeholder and starts the job with the endpoint + built input + cost", async () => {
    const tool = generateVideoTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "vid-1" });

    const result = await tool.run(
      { prompt: "a cat on a skateboard", model: "veo3.1-fast", duration: 8, resolution: "1080p", aspectRatio: "16:9", confirm: true },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(addPlaceholderCalls).toHaveLength(1);
    const placeholder = addPlaceholderCalls[0]!;
    expect(placeholder.id).toBe("vid-1");
    expect(placeholder.type).toBe("video");
    expect(placeholder.generationInput?.model).toBe("fal-ai/veo3.1/fast");
    expect(placeholder.generationInput?.prompt).toBe("a cat on a skateboard");

    expect(startJobCalls).toHaveLength(1);
    const call = startJobCalls[0]!;
    expect(call.modelEndpoint).toBe("fal-ai/veo3.1/fast");
    expect(call.model).toBe("fal-ai/veo3.1/fast");
    expect(call.costCredits).toBe(120);
    expect(call.input).toEqual({
      prompt: "a cat on a skateboard",
      duration: "8s",
      aspect_ratio: "16:9",
      resolution: "1080p",
      generate_audio: true,
    });
    expect(call.placeholders).toEqual([placeholder]);
  });

  test("returns errorResult when startJob returns an error", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade({ startJob: async () => ({ error: "fal is down" }) });
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 4, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("fal is down");
  });

  test("success names the placeholder asset id", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "vid-42" });

    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 4, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("vid-42");
  });

  // M14C follow-up: veo3.1-fast's real fal endpoint has no image field (WebFetch-verified,
  // gen-catalog.ts) -> maxReferenceImages: 0 -> reference args must reject cleanly, fast (no
  // entryUrl calls, no placeholder/job), instead of silently building input without them.
  describe("reference images (M14C follow-up)", () => {
    function makeEntryUrlTracker() {
      const calls: string[] = [];
      const entryUrl = async (ref: string) => { calls.push(ref); return `https://example.com/${ref}.png`; };
      return { calls, entryUrl };
    }

    test("referenceImageMediaRefs on a zero-cap model: clean error, no entryUrl calls, no job started", async () => {
      const tool = generateVideoTool();
      const { calls, entryUrl } = makeEntryUrlTracker();
      const { facade, addPlaceholderCalls, startJobCalls } = makeFacade({ entryUrl });
      const ctx = makeCtx({ generation: facade });

      const result = await tool.run(
        { prompt: "a cat", model: "veo3.1-fast", duration: 4, referenceImageMediaRefs: ["ref-1"], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Veo 3.1 Fast does not support reference images.");
      expect(calls).toHaveLength(0);
      expect(addPlaceholderCalls).toHaveLength(0);
      expect(startJobCalls).toHaveLength(0);
    });

    test("startImageMediaRef alone on a zero-cap model: same clean rejection", async () => {
      const tool = generateVideoTool();
      const { calls, entryUrl } = makeEntryUrlTracker();
      const { facade } = makeFacade({ entryUrl });
      const ctx = makeCtx({ generation: facade });

      const result = await tool.run(
        { prompt: "a cat", model: "veo3.1-fast", duration: 4, startImageMediaRef: "start-1", confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Veo 3.1 Fast does not support reference images.");
      expect(calls).toHaveLength(0);
    });

    test("without any reference args, behaves exactly as before (no imageUrls, no entryUrl calls)", async () => {
      const tool = generateVideoTool();
      const { calls, entryUrl } = makeEntryUrlTracker();
      const { facade, startJobCalls } = makeFacade({ entryUrl });
      const ctx = makeCtx({ generation: facade });

      const result = await tool.run({ prompt: "a cat", model: "veo3.1-fast", duration: 4, confirm: true }, ctx);

      expect(result.isError).toBe(false);
      expect(calls).toHaveLength(0);
      expect(startJobCalls[0]!.input).not.toHaveProperty("image_url");
    });
  });
});

// ── upscale_media ────────────────────────────────────────────────────────────

function makeVideoManifest(): MediaManifest {
  return {
    version: 2,
    folders: [],
    entries: [
      {
        id: "src-video",
        name: "clip.mp4",
        type: "video",
        source: { kind: "project", relativePath: "media/src-video.mp4" },
        duration: 10,
      },
      {
        id: "src-image",
        name: "still.png",
        type: "image",
        source: { kind: "project", relativePath: "media/src-image.png" },
        duration: 5,
      },
    ],
  };
}

describe("upscale_media tool", () => {
  test("has the correct name", () => {
    expect(upscaleMediaTool().name).toBe("upscale_media");
  });

  test("errors when the requested model does not support the source's type", async () => {
    const tool = upscaleMediaTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest() });

    // seedvr-upscale only supports "video"; src-image is an image.
    const result = await tool.run({ mediaRef: "src-image", model: "seedvr-upscale", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not support");
  });

  test("errors honestly when the facade cannot resolve a media URL", async () => {
    const tool = upscaleMediaTool();
    const { facade } = makeFacade({ entryUrl: undefined });
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest() });

    const result = await tool.run({ mediaRef: "src-video", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("media upload not available yet");
  });

  test("with confirm and a resolvable URL, starts the job with sourceUrl in the built input", async () => {
    const tool = upscaleMediaTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade({
      entryUrl: async (ref) => `https://example.com/${ref}.mp4`,
    });
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest(), newId: () => "up-1" });

    const result = await tool.run({ mediaRef: "src-video", confirm: true }, ctx);

    expect(result.isError).toBe(false);
    expect(addPlaceholderCalls).toHaveLength(1);
    expect(startJobCalls).toHaveLength(1);
    const call = startJobCalls[0]!;
    expect(call.modelEndpoint).toBe("fal-ai/seedvr/upscale/video");
    expect(call.input).toMatchObject({ video_url: "https://example.com/src-video.mp4" });
    expect(textOf(result)).toContain("up-1");
  });

  test("errors when the source media is not found", async () => {
    const tool = upscaleMediaTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest() });

    const result = await tool.run({ mediaRef: "does-not-exist", confirm: true }, ctx);

    expect(result.isError).toBe(true);
  });
});

// ── generate_audio ───────────────────────────────────────────────────────────

describe("generate_audio tool", () => {
  test("has the correct name", () => {
    expect(generateAudioTool().name).toBe("generate_audio");
  });

  test("errors when ctx.generation is absent", async () => {
    const tool = generateAudioTool();
    const ctx = makeCtx();

    const result = await tool.run({ prompt: "hello there", model: "elevenlabs-tts" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not available");
  });

  test("errors when no fal key is configured, pointing at settings", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade({ hasKey: async () => false });
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "hello there", model: "elevenlabs-tts" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Settings");
  });

  test("errors on an unknown model, mentioning list_models", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "hello there", model: "does-not-exist" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("list_models");
  });

  test("errors when the model is not an audio-kind model", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "hello there", model: "veo3.1-fast" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("list_models");
  });

  test("defaults duration to 10s for a TTS model (no duration given)", async () => {
    const tool = generateAudioTool();
    const { facade, addPlaceholderCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "aud-1" });

    const result = await tool.run({ prompt: "hello there", model: "elevenlabs-tts" }, ctx);

    expect(result.isError).toBe(false);
    const placeholder = addPlaceholderCalls[0]!;
    expect(placeholder.duration).toBe(10);
    expect(placeholder.generationInput?.duration).toBe(10);
  });

  test("defaults duration to 60s for a music model (no duration given)", async () => {
    const tool = generateAudioTool();
    const { facade, addPlaceholderCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "aud-2" });

    const result = await tool.run({ prompt: "an upbeat pop song", model: "minimax-music" }, ctx);

    expect(result.isError).toBe(false);
    const placeholder = addPlaceholderCalls[0]!;
    expect(placeholder.duration).toBe(60);
    expect(placeholder.generationInput?.duration).toBe(60);
  });

  test("respects an explicit duration override", async () => {
    const tool = generateAudioTool();
    const { facade, addPlaceholderCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    await tool.run({ prompt: "hello there", model: "elevenlabs-tts", duration: 20 }, ctx);

    expect(addPlaceholderCalls[0]!.duration).toBe(20);
  });

  test("over threshold without confirm returns a non-error confirmation and does not submit", async () => {
    const tool = generateAudioTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    // elevenlabs-tts @ 5 credits/1k chars; 11000 chars => ceil(55) = 55 credits, over the 50 threshold.
    const result = await tool.run({ prompt: "a".repeat(11000), model: "elevenlabs-tts" }, ctx);

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Confirmation required");
    expect(textOf(result)).toContain("55 credits");
    expect(textOf(result)).toContain("confirm: true");
    expect(addPlaceholderCalls).toHaveLength(0);
    expect(startJobCalls).toHaveLength(0);
  });

  test("with confirm: true, adds a placeholder and starts the job for a TTS model with voice in the built input", async () => {
    const tool = generateAudioTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "aud-3" });

    const result = await tool.run(
      { prompt: "hello there", model: "elevenlabs-tts", voice: "Aria", confirm: true },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(addPlaceholderCalls).toHaveLength(1);
    const placeholder = addPlaceholderCalls[0]!;
    expect(placeholder.id).toBe("aud-3");
    expect(placeholder.type).toBe("audio");
    expect(placeholder.generationInput?.model).toBe("fal-ai/elevenlabs/tts/turbo-v2.5");
    expect(placeholder.generationInput?.prompt).toBe("hello there");
    expect(placeholder.generationInput?.voice).toBe("Aria");

    expect(startJobCalls).toHaveLength(1);
    const call = startJobCalls[0]!;
    expect(call.modelEndpoint).toBe("fal-ai/elevenlabs/tts/turbo-v2.5");
    expect(call.model).toBe("fal-ai/elevenlabs/tts/turbo-v2.5");
    expect(call.input).toEqual({ text: "hello there", voice: "Aria" });
    expect(call.placeholders).toEqual([placeholder]);
  });

  test("with confirm: true, a music model's built input carries lyrics", async () => {
    const tool = generateAudioTool();
    const { facade, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    await tool.run(
      {
        prompt: "an upbeat pop song",
        model: "minimax-music",
        lyrics: "[Verse] la la la",
        instrumental: false,
        confirm: true,
      },
      ctx,
    );

    expect(startJobCalls).toHaveLength(1);
    expect(startJobCalls[0]!.input).toEqual({ prompt: "[Verse] la la la" });
  });

  test("returns errorResult when startJob returns an error", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade({ startJob: async () => ({ error: "fal is down" }) });
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "hello there", model: "elevenlabs-tts", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("fal is down");
  });

  test("success names the placeholder asset id", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "aud-42" });

    const result = await tool.run({ prompt: "hello there", model: "elevenlabs-tts", confirm: true }, ctx);

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("aud-42");
  });
});

// ── generate_audio: video-to-audio source (M14C T3, the M10 deferral) ───────

// 10s @ 30fps of video content on one track — enough room for span tests within bounds.
function makeVideoClip(): Track["clips"][number] {
  return {
    id: "vclip-1",
    mediaRef: "src-video",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 300,
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
  };
}

function makeSpanTimeline(): Timeline {
  return { ...defaultTimeline(), tracks: [{ id: "t1", type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeVideoClip()] }] };
}

function makeSpanManifest(): MediaManifest {
  return {
    version: 2,
    folders: [],
    entries: [
      { id: "src-video", name: "clip.mp4", type: "video", source: { kind: "project", relativePath: "media/src-video.mp4" }, duration: 10 },
      { id: "src-image", name: "still.png", type: "image", source: { kind: "project", relativePath: "media/src-image.png" }, duration: 5 },
    ],
  };
}

function makeSpanCtx(overrides?: Partial<ToolContext>): ToolContext {
  const store = new EditorStore(makeSpanTimeline());
  return {
    store,
    getManifest: () => makeSpanManifest(),
    newId: () => "new-id",
    ...overrides,
  };
}

describe("generate_audio: video-to-audio source (M14C T3)", () => {
  test("videoSourceStartFrame without videoSourceEndFrame errors (both-or-neither)", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run({ prompt: "footsteps", model: "mmaudio-v2", videoSourceStartFrame: 0 }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("must be provided together");
  });

  test("videoSourceMediaRef together with videoSourceStartFrame/EndFrame errors (mutually exclusive)", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceMediaRef: "src-video", videoSourceStartFrame: 0, videoSourceEndFrame: 30 },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("mutually exclusive");
  });

  test("a non-video-accepting model rejects videoSourceMediaRef", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run({ prompt: "hi", model: "elevenlabs-tts", videoSourceMediaRef: "src-video", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not accept a video input");
  });

  test("a non-video-accepting model rejects a videoSource span", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "hi", model: "elevenlabs-tts", videoSourceStartFrame: 0, videoSourceEndFrame: 30, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not accept a video input");
  });

  test("videoSourceMediaRef pointing at an unknown asset errors", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run({ prompt: "footsteps", model: "mmaudio-v2", videoSourceMediaRef: "does-not-exist", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Video source not found");
  });

  test("videoSourceMediaRef pointing at a non-video asset errors", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run({ prompt: "footsteps", model: "mmaudio-v2", videoSourceMediaRef: "src-image", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("must be a video asset");
  });

  test("videoSourceEndFrame <= videoSourceStartFrame errors", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceStartFrame: 30, videoSourceEndFrame: 30, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("must be greater than videoSourceStartFrame");
  });

  test("a videoSourceEndFrame beyond the timeline's end frame errors", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceStartFrame: 0, videoSourceEndFrame: 301, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("beyond the timeline's end frame");
  });

  test("a video-requiring model with neither source given errors, naming both options", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade();
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run({ prompt: "footsteps", model: "mmaudio-v2", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("generates audio from video");
    expect(textOf(result)).toContain("videoSourceMediaRef");
  });

  test("gate-before-render: over threshold without confirm does not render, upload, or start the job", async () => {
    const tool = generateAudioTool();
    const calls: string[] = [];
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade({
      renderSpanToMp4: async () => { calls.push("render"); return new Uint8Array([1]); },
      uploadFile: async () => { calls.push("upload"); return "https://example.com/span.mp4"; },
    });
    const ctx = makeSpanCtx({ generation: facade });

    // mmaudio-v2 @ 0.1 credits/s * 60s (2s span rounds duration... actually duration = round(span)):
    // span = 60 frames / 30fps = 2s -> duration 2 -> 2*0.1 = 0.2 -> ceil 1 credit, UNDER 50.
    // Force an over-threshold case by passing an explicit long duration instead.
    const result = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceStartFrame: 0, videoSourceEndFrame: 60, duration: 600 },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Confirmation required");
    expect(calls).toEqual([]);
    expect(addPlaceholderCalls).toHaveLength(0);
    expect(startJobCalls).toHaveLength(0);
  });

  test("facade-absent renderSpanToMp4 errors cleanly, naming the capability", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade({ renderSpanToMp4: undefined, uploadFile: async () => "https://example.com/x.mp4" });
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceStartFrame: 0, videoSourceEndFrame: 60, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Timeline span rendering is not available");
  });

  test("facade-absent uploadFile errors cleanly, naming the capability", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade({
      renderSpanToMp4: async () => new Uint8Array([1]),
      uploadFile: undefined,
    });
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceStartFrame: 0, videoSourceEndFrame: 60, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Media upload is not available");
  });

  test("span flow: render -> upload -> videoUrl in the built input, in that order", async () => {
    const tool = generateAudioTool();
    const calls: string[] = [];
    const renderArgs: unknown[] = [];
    const { facade, startJobCalls } = makeFacade({
      renderSpanToMp4: async (startFrame, frameCount, shortSide) => {
        calls.push("render");
        renderArgs.push([startFrame, frameCount, shortSide]);
        return new Uint8Array([9, 9]);
      },
      uploadFile: async (bytes, contentType) => {
        calls.push("upload");
        expect(bytes).toEqual(new Uint8Array([9, 9]));
        expect(contentType).toBe("video/mp4");
        return "https://example.com/span.mp4";
      },
    });
    const ctx = makeSpanCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "footsteps on gravel", model: "mmaudio-v2", videoSourceStartFrame: 30, videoSourceEndFrame: 90, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(calls).toEqual(["render", "upload"]);
    expect(renderArgs).toEqual([[30, 60, 360]]);

    expect(startJobCalls).toHaveLength(1);
    expect(startJobCalls[0]!.input).toEqual({
      video_url: "https://example.com/span.mp4",
      prompt: "footsteps on gravel",
      duration: 2, // (90-30)/30fps = 2s
    });
  });

  test("span flow auto-places the audio clip as ONE undo step, and does not for a media-ref source", async () => {
    const tool = generateAudioTool();
    const { facade } = makeFacade({
      renderSpanToMp4: async () => new Uint8Array([1]),
      uploadFile: async () => "https://example.com/span.mp4",
      entryUrl: async () => "https://example.com/src-video.mp4",
    });

    // Span source: auto-places.
    const spanCtx = makeSpanCtx({ generation: facade, newId: () => "placeholder-span" });
    const before = spanCtx.store.getSnapshot().timeline;
    const result = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceStartFrame: 30, videoSourceEndFrame: 90, confirm: true },
      spanCtx,
    );
    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("placed on the timeline at frame 30");
    expect(textOf(result)).toContain("Sound Effects"); // the category label (undo action name is "Add Sound Effects")

    const after = spanCtx.store.getSnapshot().timeline;
    expect(after.tracks).toHaveLength(2); // the existing video track + a new audio track
    const audioTrack = after.tracks[1]!;
    expect(audioTrack.type).toBe("audio");
    expect(audioTrack.clips).toHaveLength(1);
    const placedClip = audioTrack.clips[0]!;
    expect(placedClip.mediaRef).toBe("placeholder-span");
    expect(placedClip.startFrame).toBe(30);
    expect(placedClip.durationFrames).toBe(60);

    expect(spanCtx.store.canUndo()).toBe(true);
    spanCtx.store.undo();
    expect(spanCtx.store.getSnapshot().timeline).toEqual(before); // exactly one undo step

    // Media-ref source: library-only, no timeline change at all.
    const refCtx = makeSpanCtx({ generation: facade, newId: () => "placeholder-ref" });
    const refBefore = refCtx.store.getSnapshot().timeline;
    const refResult = await tool.run(
      { prompt: "footsteps", model: "mmaudio-v2", videoSourceMediaRef: "src-video", confirm: true },
      refCtx,
    );
    expect(refResult.isError).toBe(false);
    expect(textOf(refResult)).not.toContain("placed on the timeline");
    expect(refCtx.store.getSnapshot().timeline).toEqual(refBefore);
    expect(refCtx.store.canUndo()).toBe(false);
  });
});

// ── list_models ─────────────────────────────────────────────────────────────

describe("list_models tool", () => {
  test("has the correct name", () => {
    expect(listModelsTool().name).toBe("list_models");
  });

  test("with no kind, returns every catalog entry", async () => {
    const tool = listModelsTool();
    const ctx = makeCtx();

    const result = await tool.run({}, ctx);

    expect(result.isError).toBe(false);
    const payload = JSON.parse(textOf(result)) as { models: { kind: string }[] };
    const kinds = new Set(payload.models.map((m) => m.kind));
    expect(kinds).toEqual(new Set(["video", "image", "audio", "upscale"]));
  });

  test("with kind: video, returns only video entries", async () => {
    const tool = listModelsTool();
    const ctx = makeCtx();

    const result = await tool.run({ kind: "video" }, ctx);

    expect(result.isError).toBe(false);
    const payload = JSON.parse(textOf(result)) as { models: { id: string; kind: string }[] };
    expect(payload.models.length).toBeGreaterThan(0);
    for (const m of payload.models) expect(m.kind).toBe("video");
    expect(payload.models.map((m) => m.id)).toContain("veo3.1-fast");
  });

  test("each entry carries id, kind, displayName, capabilities, and estimatedCost", async () => {
    const tool = listModelsTool();
    const ctx = makeCtx();

    const result = await tool.run({ kind: "video" }, ctx);

    const payload = JSON.parse(textOf(result)) as {
      models: { id: string; kind: string; displayName: string; capabilities: unknown; estimatedCost: string }[];
    };
    const veo = payload.models.find((m) => m.id === "veo3.1-fast")!;
    expect(veo.kind).toBe("video");
    expect(veo.displayName).toBe("Veo 3.1 Fast");
    expect(veo.capabilities).toMatchObject({ durations: [4, 6, 8] });
    expect(typeof veo.estimatedCost).toBe("string");
    expect(veo.estimatedCost.length).toBeGreaterThan(0);
  });

  test("the note mentions that generate_*/upscale tools take the id as model", async () => {
    const tool = listModelsTool();
    const ctx = makeCtx();

    const result = await tool.run({}, ctx);

    const payload = JSON.parse(textOf(result)) as { note: string };
    expect(payload.note).toContain("model");
  });
});
