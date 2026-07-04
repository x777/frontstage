// Curated fal.ai generation model catalog — the data layer behind generate_video/audio/image/upscale.
// Endpoints/schemas/prices verified against fal.ai model pages + openapi.json 2026-07; see task-1-report.md
// for per-entry verification notes. All fal-specific field names live in this file only.

export type GenModelKind = "video" | "image" | "audio" | "upscale" | "transcribe";

export interface GenModelCaps {
  durations?: number[];
  aspectRatios?: string[];
  resolutions?: string[];
  maxReferenceImages?: number;
  supportsStartEndFrames?: boolean;
  voices?: string[];
  supportsLyrics?: boolean;
  supportsInstrumental?: boolean;
  numImagesMax?: number;
  upscaleInputs?: ("video" | "image")[];
  // M14C T3 (generate_audio's video-to-audio source, the M10 deferral) — mirrors Swift's
  // AudioModelConfig.Input: acceptsVideo gates the tool's videoSource* fields; requiresVideo
  // mirrors Swift's "acceptsVideo && !inputs.contains(.text)" — no source given is an error.
  acceptsVideo?: boolean;
  requiresVideo?: boolean;
  // Drives the auto-place undo action name ("Add <label>") — mirrors Swift's
  // AudioModelConfig.Category. Defaults to "music" when supportsLyrics, else "speech".
  category?: "speech" | "music" | "sfx";
}

export type GenPricing =
  | { kind: "perSecond"; creditsPerSecond: Record<string, number> }
  | { kind: "perImage"; creditsPerImage: Record<string, number> }
  | { kind: "audioPerSecond"; creditsPerSecond: number }
  | { kind: "audioPerThousandChars"; creditsPer1k: number }
  | { kind: "flat"; credits: number }
  | { kind: "upscalePerSecond"; creditsPerSecond: number };

export interface GenToolParams {
  prompt?: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  numImages?: number;
  voice?: string;
  lyrics?: string;
  instrumental?: boolean;
  imageUrls?: string[];
  sourceUrl?: string;
  language?: string;
  // generate_audio's video-to-audio source (M14C T3) — the uploaded media-ref file or
  // span-rendered mp4's URL, separate from sourceUrl (upscale/transcribe's convention).
  videoUrl?: string;
}

export interface GenModelEntry {
  id: string;
  endpoint: string;
  kind: GenModelKind;
  displayName: string;
  caps: GenModelCaps;
  pricing: GenPricing;
  buildInput(params: GenToolParams): Record<string, unknown>;
}

function unsupportedValue(displayName: string, field: string, value: string, allowed: string[]): string {
  return `${displayName} does not support ${field} '${value}'. Valid: ${allowed.join(", ")}.`;
}

// M14C follow-up ("wire imageUrls into reference-capable model inputs"): WebFetch-verified 2026-07
// (doc pages + fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint>, both independently) that
// NONE of the 5 catalogued image/video endpoints below accept an image/reference conditioning field —
// veo3.1/fast, kling-video/v2.5-turbo/pro/text-to-video, bytedance/seedance/v1/pro/text-to-video,
// nano-banana, and flux/dev are all pure text-to-X with no image_url/image_urls field in their real
// request schema. Reference-conditioned variants DO exist, but as SEPARATE fal endpoint ids
// (fal-ai/nano-banana/edit: image_urls[]; fal-ai/veo3.1/fast/image-to-video,
// fal-ai/kling-video/v2.5-turbo/pro/image-to-video, fal-ai/bytedance/seedance/v1/pro/image-to-video:
// image_url + optional end/tail frame; fal-ai/flux/dev/image-to-image: image_url) — switching
// GenModelEntry.endpoint per-request is real, separate scope (touches ~10 call sites across 3 files;
// see task-3-report.md's identical declination), so buildInput is left untouched here. Each entry
// below declares maxReferenceImages: 0 so the cap logic (this file + the tool layer + the panel)
// reports "does not support reference images" cleanly instead of silently dropping them.
export function referenceCapError(entry: GenModelEntry, count: number): string | null {
  const cap = entry.caps.maxReferenceImages;
  if (cap === undefined || count <= cap) return null;
  if (cap === 0) return `${entry.displayName} does not support reference images.`;
  return `${entry.displayName} accepts at most ${cap} reference image(s) (got ${count}).`;
}

// fal-ai/flux/dev takes an `image_size` enum, not a bare aspect ratio — map our normalized
// aspectRatio onto the closest fal token (verified via openapi.json 2026-07).
const FLUX_DEV_ASPECT_TO_IMAGE_SIZE: Record<string, string> = {
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
};

const CATALOG: GenModelEntry[] = [
  // --- video ---
  {
    id: "veo3.1-fast",
    endpoint: "fal-ai/veo3.1/fast",
    kind: "video",
    displayName: "Veo 3.1 Fast",
    caps: {
      durations: [4, 6, 8],
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p", "1080p", "4k"],
      // supportsStartEndFrames names the SEPARATE fal-ai/veo3.1/fast/image-to-video endpoint's
      // capability, not this endpoint's (see the verification note above buildInput's caller) —
      // maxReferenceImages: 0 reflects THIS entry's real (text-only) wire schema honestly.
      supportsStartEndFrames: true,
      maxReferenceImages: 0,
    },
    pricing: {
      kind: "perSecond",
      // $0.15/s at 720p/1080p, $0.35/s at 4k (audio on, the schema default) — fal.ai 2026-07.
      creditsPerSecond: { "720p": 15, "1080p": 15, "4k": 35, default: 15 },
    },
    buildInput(params) {
      return {
        prompt: params.prompt ?? "",
        duration: `${params.duration ?? 8}s`,
        aspect_ratio: params.aspectRatio ?? "16:9",
        resolution: params.resolution ?? "720p",
        generate_audio: true,
      };
    },
  },
  {
    id: "kling-2.5",
    endpoint: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    kind: "video",
    displayName: "Kling 2.5 Turbo Pro",
    caps: {
      durations: [5, 10],
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxReferenceImages: 0,
    },
    pricing: {
      // $0.35 for 5s / $0.70 for 10s == flat $0.07/s — fal.ai 2026-07.
      kind: "perSecond",
      creditsPerSecond: { default: 7 },
    },
    buildInput(params) {
      return {
        prompt: params.prompt ?? "",
        duration: String(params.duration ?? 5),
        aspect_ratio: params.aspectRatio ?? "16:9",
      };
    },
  },
  {
    id: "seedance-1.0",
    endpoint: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
    kind: "video",
    displayName: "Seedance 1.0 Pro",
    caps: {
      durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      resolutions: ["480p", "720p", "1080p"],
      maxReferenceImages: 0,
    },
    pricing: {
      // 1080p confirmed ($0.62/5s == $0.124/s); 720p/480p pixel-scaled off that point and
      // rounded up (conservative — best-effort, needs a real-key check). fal.ai 2026-07.
      kind: "perSecond",
      creditsPerSecond: { "1080p": 12.4, "720p": 6, "480p": 3, default: 12.4 },
    },
    buildInput(params) {
      return {
        prompt: params.prompt ?? "",
        duration: String(params.duration ?? 5),
        aspect_ratio: params.aspectRatio ?? "16:9",
        resolution: params.resolution ?? "1080p",
      };
    },
  },

  // --- image ---
  {
    id: "nano-banana",
    endpoint: "fal-ai/nano-banana",
    kind: "image",
    displayName: "Nano Banana",
    caps: {
      aspectRatios: ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"],
      numImagesMax: 4,
      maxReferenceImages: 0,
    },
    pricing: {
      // $0.0398/image — fal.ai pricing page 2026-07.
      kind: "perImage",
      creditsPerImage: { default: 3.98 },
    },
    buildInput(params) {
      return {
        prompt: params.prompt ?? "",
        aspect_ratio: params.aspectRatio ?? "1:1",
        num_images: params.numImages ?? 1,
      };
    },
  },
  {
    id: "flux-dev",
    endpoint: "fal-ai/flux/dev",
    kind: "image",
    displayName: "FLUX.1 [dev]",
    caps: {
      aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      numImagesMax: 4,
      maxReferenceImages: 0,
    },
    pricing: {
      // $0.025/megapixel, billed rounded up — approximated flat per-image at ~1MP. fal.ai 2026-07.
      kind: "perImage",
      creditsPerImage: { default: 2.5 },
    },
    buildInput(params) {
      const aspect = params.aspectRatio ?? "4:3";
      return {
        prompt: params.prompt ?? "",
        image_size: FLUX_DEV_ASPECT_TO_IMAGE_SIZE[aspect] ?? "landscape_4_3",
        num_images: params.numImages ?? 1,
      };
    },
  },

  // --- audio ---
  {
    id: "elevenlabs-tts",
    endpoint: "fal-ai/elevenlabs/tts/turbo-v2.5",
    kind: "audio",
    displayName: "ElevenLabs TTS Turbo v2.5",
    caps: {
      category: "speech",
      voices: [
        "Rachel", "Aria", "Roger", "Sarah", "Laura", "Charlie", "George", "Callum", "River",
        "Liam", "Charlotte", "Alice", "Matilda", "Will", "Jessica", "Eric", "Chris", "Brian",
        "Daniel", "Lily", "Bill",
      ],
    },
    pricing: {
      // $0.05 per 1000 characters — fal.ai 2026-07.
      kind: "audioPerThousandChars",
      creditsPer1k: 5,
    },
    buildInput(params) {
      return {
        text: params.prompt ?? "",
        voice: params.voice ?? "Rachel",
      };
    },
  },
  {
    id: "minimax-music",
    endpoint: "fal-ai/minimax-music",
    kind: "audio",
    displayName: "MiniMax Music",
    caps: {
      category: "music",
      supportsLyrics: true,
    },
    pricing: {
      // $0.035 per generation, flat — fal.ai 2026-07.
      kind: "flat",
      credits: 3.5,
    },
    buildInput(params) {
      const body: Record<string, unknown> = { prompt: params.lyrics ?? params.prompt ?? "" };
      if (params.sourceUrl) body["reference_audio_url"] = params.sourceUrl;
      return body;
    },
  },
  {
    id: "mmaudio-v2",
    endpoint: "fal-ai/mmaudio-v2",
    kind: "audio",
    displayName: "MMAudio V2",
    caps: {
      category: "sfx",
      acceptsVideo: true,
      requiresVideo: true,
    },
    pricing: {
      // $0.001/s — fal.ai 2026-07. FLAGGED: fal's own schema documents this endpoint's output as
      // a MUXED video file (the generated audio synced onto the input video), not a standalone
      // audio file — needs a real-key smoke test to confirm the downloaded bytes work as this
      // app's "audio" asset type. Mirrors Swift's AudioGenerationSubmission, which also downloads
      // and labels every audio-kind result uniformly (assetType .audio, "mp3") regardless of the
      // real backend model's container.
      kind: "audioPerSecond",
      creditsPerSecond: 0.1,
    },
    buildInput(params) {
      return {
        video_url: params.videoUrl ?? "",
        prompt: params.prompt ?? "",
        duration: params.duration ?? 8,
      };
    },
  },

  // --- upscale ---
  {
    id: "seedvr-upscale",
    endpoint: "fal-ai/seedvr/upscale/video",
    kind: "upscale",
    displayName: "SeedVR Upscale",
    caps: {
      resolutions: ["720p", "1080p", "1440p", "2160p"],
      upscaleInputs: ["video"],
    },
    pricing: {
      // $0.001/megapixel-frame; approximated to ~$0.05/s at 1080p/24fps (best-effort). fal.ai 2026-07.
      kind: "upscalePerSecond",
      creditsPerSecond: 5,
    },
    buildInput(params) {
      return {
        video_url: params.sourceUrl ?? "",
        upscale_mode: "target",
        target_resolution: params.resolution ?? "1080p",
      };
    },
  },

  // --- transcribe ---
  {
    id: "whisper",
    endpoint: "fal-ai/whisper",
    kind: "transcribe",
    displayName: "Whisper v3",
    caps: {},
    pricing: {
      // fal exposes no static per-second rate here either (the model/pricing pages both render a
      // client-side "$0 per compute second" placeholder; openapi.json carries no cost field). A
      // third-party fal-price scrape lists non-turbo fal-ai/whisper at ~0.111cr/s ($0.00111/
      // compute-second). Billing is per COMPUTE second, so the real cost per AUDIO-second is likely
      // much lower in practice — this figure is deliberately conservative so the confirm-gate errs
      // safe. FLAGGED: needs a real-key smoke test to confirm actual per-audio-second cost.
      kind: "audioPerSecond",
      creditsPerSecond: 0.111,
    },
    buildInput(params) {
      return {
        audio_url: params.sourceUrl ?? "",
        task: "transcribe",
        // fal-ai/whisper's verified openapi.json (2026-07) confirms chunk_level is a real enum
        // ["none","segment","word"] (unlike wizper's const:"segment") — native word-level chunks.
        // No merge_chunks/max_segment_len field exists on this endpoint (that was wizper-only).
        chunk_level: "word",
        ...(params.language ? { language: params.language } : {}),
      };
    },
  },
];

// Matches the friendly id OR the fal endpoint — the generation log stores the endpoint.
export function genModel(id: string): GenModelEntry | undefined {
  return CATALOG.find((e) => e.id === id || e.endpoint === id);
}

export function listGenModels(kind?: GenModelKind): GenModelEntry[] {
  return kind === undefined ? CATALOG.slice() : CATALOG.filter((e) => e.kind === kind);
}

export function validateGenParams(entry: GenModelEntry, params: GenToolParams): string | null {
  const { displayName, caps } = entry;

  if (caps.durations !== undefined && params.duration !== undefined && !caps.durations.includes(params.duration)) {
    return unsupportedValue(displayName, "duration", `${params.duration}s`, caps.durations.map((d) => `${d}s`));
  }
  if (
    caps.aspectRatios !== undefined &&
    params.aspectRatio !== undefined &&
    !caps.aspectRatios.includes(params.aspectRatio)
  ) {
    return unsupportedValue(displayName, "aspect ratio", params.aspectRatio, caps.aspectRatios);
  }
  if (
    caps.resolutions !== undefined &&
    params.resolution !== undefined &&
    !caps.resolutions.includes(params.resolution)
  ) {
    return unsupportedValue(displayName, "resolution", params.resolution, caps.resolutions);
  }
  if (caps.maxReferenceImages !== undefined && params.imageUrls !== undefined) {
    const capError = referenceCapError(entry, params.imageUrls.length);
    if (capError) return capError;
  }
  if (caps.numImagesMax !== undefined && params.numImages !== undefined) {
    if (params.numImages < 1 || params.numImages > caps.numImagesMax) {
      return `${displayName} supports 1-${caps.numImagesMax} image(s) per request (got ${params.numImages}).`;
    }
  }
  if (caps.voices !== undefined && params.voice !== undefined && !caps.voices.includes(params.voice)) {
    return unsupportedValue(displayName, "voice", params.voice, caps.voices);
  }

  if (entry.kind === "audio") {
    const hasText = (params.prompt ?? "").trim().length > 0 || (params.lyrics ?? "").trim().length > 0;
    if (!hasText) return `${displayName} requires a prompt.`;
  } else if (entry.kind === "upscale") {
    if (!params.sourceUrl || params.sourceUrl.trim().length === 0) {
      return `${displayName} requires a source video URL.`;
    }
  } else if (entry.kind === "transcribe") {
    if (!params.sourceUrl || params.sourceUrl.trim().length === 0) {
      return `${displayName} requires a source audio URL.`;
    }
  } else {
    if (!params.prompt || params.prompt.trim().length === 0) {
      return `${displayName} requires a prompt.`;
    }
  }

  return null;
}
