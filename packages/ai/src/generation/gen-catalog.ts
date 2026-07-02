// Curated fal.ai generation model catalog — the data layer behind generate_video/audio/image/upscale.
// Endpoints/schemas/prices verified against fal.ai model pages + openapi.json 2026-07; see task-1-report.md
// for per-entry verification notes. All fal-specific field names live in this file only.

export type GenModelKind = "video" | "image" | "audio" | "upscale";

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
      supportsStartEndFrames: true,
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
];

export function genModel(id: string): GenModelEntry | undefined {
  return CATALOG.find((e) => e.id === id);
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
  if (
    caps.maxReferenceImages !== undefined &&
    params.imageUrls !== undefined &&
    params.imageUrls.length > caps.maxReferenceImages
  ) {
    return `${displayName} accepts at most ${caps.maxReferenceImages} reference image(s) (got ${params.imageUrls.length}).`;
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
  } else {
    if (!params.prompt || params.prompt.trim().length === 0) {
      return `${displayName} requires a prompt.`;
    }
  }

  return null;
}
