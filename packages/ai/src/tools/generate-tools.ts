import { z } from "zod";
import type { GenerationInput, MediaManifestEntry } from "@palmier/core";
import { createPlaceholderEntry } from "@palmier/core";
import type { ToolResult, ToolSpec, ToolContext } from "./types.js";
import { ok, errorResult } from "./executor.js";
import { genModel, listGenModels, validateGenParams } from "../generation/gen-catalog.js";
import type { GenModelEntry, GenModelKind, GenToolParams } from "../generation/gen-catalog.js";
import { estimateCredits, formatCredits } from "../generation/cost-estimator.js";

type Generation = NonNullable<ToolContext["generation"]>;

export function keyMissingError(action: string): ToolResult {
  return errorResult(`No fal.ai API key configured. Add one in Settings to ${action}.`);
}

export function unknownModelError(id: string, kind: GenModelKind): ToolResult {
  return errorResult(`Unknown ${kind} model '${id}'. Call list_models (kind='${kind}') to see available models.`);
}

export function confirmationResult(estimate: number): ToolResult {
  return ok(`Confirmation required: this will cost ~${formatCredits(estimate)}. Re-call with confirm: true to proceed.`);
}

async function submit(
  generation: Generation,
  entry: GenModelEntry,
  input: Record<string, unknown>,
  placeholder: MediaManifestEntry,
  estimate: number,
  startedLabel: string,
): Promise<ToolResult> {
  generation.addPlaceholder(placeholder);
  const result = await generation.startJob({
    modelEndpoint: entry.endpoint,
    input,
    placeholders: [placeholder],
    model: entry.endpoint,
    costCredits: estimate,
  });
  if ("error" in result) return errorResult(result.error);
  return ok(
    `${startedLabel} Placeholder asset ID: ${placeholder.id}. It will appear in the media library when ready. Estimated cost: ${formatCredits(estimate)}.`,
  );
}

export function generateVideoTool(): ToolSpec {
  return {
    name: "generate_video",
    description:
      "Starts an async AI video generation. Returns a placeholder asset ID immediately; generation runs in the background and the asset becomes usable once ready. Costs real money and is not undoable. Call list_models first to see available models.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      model: z.string().min(1),
      duration: z.number().optional(),
      aspectRatio: z.string().optional(),
      resolution: z.string().optional(),
      startImageMediaRef: z.string().optional(),
      referenceImageMediaRefs: z.array(z.string()).optional(),
      confirm: z.boolean().optional(),
    }),
    async run(args, ctx) {
      const a = args as {
        prompt: string;
        model: string;
        duration?: number;
        aspectRatio?: string;
        resolution?: string;
        startImageMediaRef?: string;
        referenceImageMediaRefs?: string[];
        confirm?: boolean;
      };

      if (!ctx.generation) return errorResult("generation is not available in this context");
      if (!(await ctx.generation.hasKey())) return keyMissingError("generate video");

      const entry = genModel(a.model);
      if (!entry || entry.kind !== "video") return unknownModelError(a.model, "video");

      const params: GenToolParams = {
        prompt: a.prompt,
        duration: a.duration,
        aspectRatio: a.aspectRatio,
        resolution: a.resolution,
      };

      const validationError = validateGenParams(entry, params);
      if (validationError) return errorResult(validationError);

      const estimate = estimateCredits(entry, params);
      if (estimate > ctx.generation.confirmThreshold && !a.confirm) return confirmationResult(estimate);

      // Optional reference images: resolve silently-best-effort if the facade supports it, else skip.
      if (ctx.generation.entryUrl) {
        const refs: string[] = [];
        if (a.startImageMediaRef) {
          const url = await ctx.generation.entryUrl(a.startImageMediaRef);
          if (url) refs.push(url);
        }
        for (const ref of a.referenceImageMediaRefs ?? []) {
          const url = await ctx.generation.entryUrl(ref);
          if (url) refs.push(url);
        }
        if (refs.length > 0) params.imageUrls = refs;
      }

      // No explicit "default duration" field on GenModelEntry — the first allowed duration
      // is the most sensible fallback, and pinning it here keeps the placeholder's duration
      // consistent with what buildInput actually sends (rather than buildInput's own internal default).
      const duration = params.duration ?? entry.caps.durations?.[0] ?? 5;
      params.duration = duration;

      const input = entry.buildInput(params);

      const genInput: GenerationInput = {
        prompt: a.prompt,
        model: entry.endpoint,
        duration,
        aspectRatio: a.aspectRatio ?? "",
        resolution: a.resolution,
        createdAt: new Date().toISOString(),
      };
      const placeholder = createPlaceholderEntry({
        id: ctx.newId(),
        type: "video",
        name: a.prompt.slice(0, 30),
        duration,
        ext: "mp4",
        genInput,
      });

      return submit(ctx.generation, entry, input, placeholder, estimate, "Generation started.");
    },
  };
}

export function upscaleMediaTool(): ToolSpec {
  return {
    name: "upscale_media",
    description:
      "Upscales an existing video or image asset to higher resolution using an AI upscaler. Returns a placeholder asset ID immediately; the upscaled asset appears in the media library once ready. Use list_models (kind='upscale') to pick a model that supports the asset's type. Costs real money and is not undoable.",
    inputSchema: z.object({
      mediaRef: z.string().min(1),
      model: z.string().optional(),
      confirm: z.boolean().optional(),
    }),
    async run(args, ctx) {
      const a = args as { mediaRef: string; model?: string; confirm?: boolean };

      if (!ctx.generation) return errorResult("generation is not available in this context");
      if (!(await ctx.generation.hasKey())) return keyMissingError("upscale media");

      const source = ctx.getManifest().entries.find((e) => e.id === a.mediaRef);
      if (!source) return errorResult(`Media not found: ${a.mediaRef}`);
      if (source.type !== "video" && source.type !== "image") {
        return errorResult(`Upscale supports video and image assets only (got ${source.type}).`);
      }
      const sourceType = source.type;

      let entry: GenModelEntry | undefined;
      if (a.model) {
        entry = genModel(a.model);
        if (!entry || entry.kind !== "upscale") return unknownModelError(a.model, "upscale");
        if (!entry.caps.upscaleInputs?.includes(sourceType)) {
          return errorResult(
            `${entry.displayName} does not support upscaling ${sourceType} assets. Supported: ${(entry.caps.upscaleInputs ?? []).join(", ") || "none"}.`,
          );
        }
      } else {
        entry = listGenModels("upscale").find((e) => e.caps.upscaleInputs?.includes(sourceType));
        if (!entry) {
          return errorResult(`No upscale model available for ${sourceType} assets. Call list_models (kind='upscale').`);
        }
      }

      // Estimate over the source's own duration; a still image is a flat 1-second charge.
      const sourceDuration = sourceType === "image" ? 1 : source.duration;
      const params: GenToolParams = { duration: sourceDuration };
      const estimate = estimateCredits(entry, params);
      if (estimate > ctx.generation.confirmThreshold && !a.confirm) return confirmationResult(estimate);

      const sourceUrl = ctx.generation.entryUrl ? await ctx.generation.entryUrl(a.mediaRef) : undefined;
      if (!sourceUrl) return errorResult("media upload not available yet");
      params.sourceUrl = sourceUrl;

      const input = entry.buildInput(params);

      const genInput: GenerationInput = {
        prompt: "",
        model: entry.endpoint,
        duration: sourceDuration,
        aspectRatio: "",
        createdAt: new Date().toISOString(),
      };
      const placeholder = createPlaceholderEntry({
        id: ctx.newId(),
        type: source.type,
        name: `${source.name} (upscaled)`,
        duration: sourceDuration,
        ext: source.type === "video" ? "mp4" : "png",
        genInput,
      });

      return submit(ctx.generation, entry, input, placeholder, estimate, "Upscale started.");
    },
  };
}

export function generateAudioTool(): ToolSpec {
  return {
    name: "generate_audio",
    description:
      "Starts an async AI audio generation: text-to-speech or text-to-music. Returns a placeholder asset ID immediately; generation runs in the background and the asset becomes usable once ready. Video-to-audio / video-scoring generation (matching an audio track to a timeline span or video asset) is NOT available yet. Call list_models (kind='audio') first to see available models, their voices, and whether they support lyrics or instrumental tracks. Costs real money and is not undoable.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      model: z.string().min(1),
      voice: z.string().optional(),
      lyrics: z.string().optional(),
      styleInstructions: z.string().optional(),
      instrumental: z.boolean().optional(),
      duration: z.number().optional(),
      confirm: z.boolean().optional(),
    }),
    async run(args, ctx) {
      const a = args as {
        prompt: string;
        model: string;
        voice?: string;
        lyrics?: string;
        styleInstructions?: string;
        instrumental?: boolean;
        duration?: number;
        confirm?: boolean;
      };

      if (!ctx.generation) return errorResult("generation is not available in this context");
      if (!(await ctx.generation.hasKey())) return keyMissingError("generate audio");

      const entry = genModel(a.model);
      if (!entry || entry.kind !== "audio") return unknownModelError(a.model, "audio");

      const params: GenToolParams = {
        prompt: a.prompt,
        voice: a.voice,
        lyrics: a.lyrics,
        instrumental: a.instrumental,
        duration: a.duration,
      };

      const validationError = validateGenParams(entry, params);
      if (validationError) return errorResult(validationError);

      const estimate = estimateCredits(entry, params);
      if (estimate > ctx.generation.confirmThreshold && !a.confirm) return confirmationResult(estimate);

      // Swift's TTS/music placeholder-duration heuristic (Defaults.audio{TTS,Music}DurationSeconds):
      // models that support lyrics are music (long-form), everything else is TTS (short-form).
      const duration = a.duration ?? (entry.caps.supportsLyrics ? 60 : 10);
      params.duration = duration;

      const input = entry.buildInput(params);

      const genInput: GenerationInput = {
        prompt: a.prompt,
        model: entry.endpoint,
        duration,
        aspectRatio: "",
        voice: a.voice,
        lyrics: a.lyrics,
        styleInstructions: a.styleInstructions,
        instrumental: a.instrumental,
        createdAt: new Date().toISOString(),
      };
      const placeholder = createPlaceholderEntry({
        id: ctx.newId(),
        type: "audio",
        name: a.prompt.slice(0, 30),
        duration,
        ext: "mp3",
        genInput,
      });

      return submit(ctx.generation, entry, input, placeholder, estimate, "Generation started.");
    },
  };
}
