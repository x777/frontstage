import { z } from "zod";
import type { EditorStore, GenerationInput, MediaManifestEntry, Timeline } from "@frontstage/core";
import { addClipCommand, createPlaceholderEntry, resolveOrCreateAudioTrack, timelineTotalFrames } from "@frontstage/core";
import type { ToolResult, ToolSpec, ToolContext } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";
import { genModel, listGenModels, validateGenParams, referenceCapError } from "../generation/gen-catalog.js";
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
  // Runs right after a successful startJob and, if given, REPLACES the default success message —
  // generate_audio's span-source auto-place (M14C T3) hooks in here to place the timeline clip
  // and report the placement in the same response.
  afterStarted?: () => string,
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
  if (afterStarted) return ok(afterStarted());
  return ok(
    `${startedLabel} Placeholder asset ID: ${placeholder.id}. It will appear in the media library when ready. Estimated cost: ${formatCredits(estimate)}.`,
  );
}

const AUDIO_CATEGORY_LABELS = { speech: "Speech", music: "Music", sfx: "Sound Effects" } as const;

function audioCategoryLabel(entry: GenModelEntry): string {
  const category = entry.caps.category ?? (entry.caps.supportsLyrics ? "music" : "speech");
  return AUDIO_CATEGORY_LABELS[category];
}

// Places the generating placeholder as an audio clip at [startFrame, startFrame + frameCount) —
// mirrors Swift's placeGeneratingAudioClip: resolve-or-create a free audio track, then place the
// clip referencing the placeholder's mediaRef, as ONE undo step. There's no TS analogue yet to
// Swift's finalizeGeneratingClip (which re-syncs the clip's duration once the real asset downloads)
// — the clip keeps the span length it was placed with; see task-3-report.md.
function placeGeneratingAudioClip(
  store: EditorStore,
  newId: () => string,
  placeholder: MediaManifestEntry,
  startFrame: number,
  frameCount: number,
  actionName: string,
): void {
  const fps = store.getSnapshot().timeline.fps;
  let trackIndex = -1;
  asUndoStep(store, actionName, [
    (t: Timeline) => {
      const resolved = resolveOrCreateAudioTrack(t, startFrame, frameCount, newId);
      trackIndex = resolved.trackIndex;
      return resolved.timeline;
    },
    (t: Timeline) =>
      addClipCommand(placeholder, { kind: "existing", index: trackIndex }, startFrame, fps, undefined, newId, frameCount).apply(t),
  ]);
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
      if (!(await ctx.generation.hasKey().catch(() => false))) return keyMissingError("generate video");

      const entry = genModel(a.model);
      if (!entry || entry.kind !== "video") return unknownModelError(a.model, "video");

      // Resolve the effective duration BEFORE estimating: an omitted duration must be
      // priced at the model's default, not 0 — otherwise the cost gate is bypassable.
      const duration = a.duration ?? entry.caps.durations?.[0] ?? 5;
      const params: GenToolParams = {
        prompt: a.prompt,
        duration,
        aspectRatio: a.aspectRatio,
        resolution: a.resolution,
      };

      const validationError = validateGenParams(entry, params);
      if (validationError) return errorResult(validationError);

      const estimate = estimateCredits(entry, params);
      if (estimate > ctx.generation.confirmThreshold && !a.confirm) return confirmationResult(estimate);

      // Optional reference images: reject fast (no network calls) when the model's real fal
      // endpoint has no image field at all (maxReferenceImages: 0 — see gen-catalog.ts's
      // verification note) instead of silently resolving refs that buildInput will never forward.
      const refMediaIds = [a.startImageMediaRef, ...(a.referenceImageMediaRefs ?? [])].filter(
        (id): id is string => id !== undefined,
      );
      if (refMediaIds.length > 0) {
        const capError = referenceCapError(entry, refMediaIds.length);
        if (capError) return errorResult(capError);
      }
      if (ctx.generation.entryUrl && refMediaIds.length > 0) {
        const refs: string[] = [];
        for (const id of refMediaIds) {
          const url = await ctx.generation.entryUrl(id);
          if (url) refs.push(url);
        }
        if (refs.length > 0) params.imageUrls = refs;
      }

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

// A single representative formatCredits() line per pricing kind, so list_models can show
// a cost without requiring the agent to supply a full param set up front.
function representativeCost(entry: GenModelEntry): string {
  const pricing = entry.pricing;
  switch (pricing.kind) {
    case "perSecond": {
      const resolution = entry.caps.resolutions?.[0];
      const estimate = estimateCredits(entry, { duration: 1, resolution });
      return resolution ? `${formatCredits(estimate)}/s at ${resolution}` : `${formatCredits(estimate)}/s`;
    }
    case "perImage": {
      const estimate = estimateCredits(entry, { numImages: 1 });
      return `${formatCredits(estimate)}/image`;
    }
    case "audioPerSecond": {
      const estimate = estimateCredits(entry, { duration: 1 });
      return `${formatCredits(estimate)}/s`;
    }
    case "audioPerThousandChars": {
      const estimate = estimateCredits(entry, { prompt: "x".repeat(1000) });
      return `${formatCredits(estimate)} per 1000 chars`;
    }
    case "flat": {
      const estimate = estimateCredits(entry, {});
      return formatCredits(estimate);
    }
    case "upscalePerSecond": {
      const estimate = estimateCredits(entry, { duration: 1 });
      return `${formatCredits(estimate)}/s`;
    }
  }
}

export function listModelsTool(): ToolSpec {
  return {
    name: "list_models",
    description:
      "Call this before any generate_*/upscale call to discover models, capabilities, and costs.",
    inputSchema: z.object({
      kind: z.enum(["video", "image", "audio", "upscale"]).optional(),
    }),
    run(args, _ctx) {
      const a = args as { kind?: GenModelKind };
      // "transcribe" (whisper) isn't a generate_*/upscale_media model choice — it's driven by its
      // own TranscriptionService orchestration (M11B's transcript tools), so it's excluded here.
      const models = listGenModels(a.kind)
        .filter((entry) => entry.kind !== "transcribe")
        .map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          displayName: entry.displayName,
          capabilities: entry.caps,
          estimatedCost: representativeCost(entry),
        }));
      const payload = {
        note: "generate_video, generate_audio, generate_image, and upscale_media take the `id` field below as their `model` parameter.",
        models,
      };
      return ok(JSON.stringify(payload, null, 2));
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
      if (!(await ctx.generation.hasKey().catch(() => false))) return keyMissingError("upscale media");

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
      "Starts an async AI audio generation: text-to-speech, text-to-music, or video-scored audio (matching a soundtrack to a timeline span or an existing video asset — pass videoSourceStartFrame + videoSourceEndFrame, or videoSourceMediaRef, mutually exclusive). Returns a placeholder asset ID immediately; generation runs in the background and the asset becomes usable once ready. A timeline-span source auto-places the result on the timeline as one undo step; a media-ref source stays library-only (place it with add_clips). Call list_models (kind='audio') first to see available models, their voices, and whether they support lyrics, instrumental tracks, or video input. Costs real money and is not undoable.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      model: z.string().min(1),
      voice: z.string().optional(),
      lyrics: z.string().optional(),
      styleInstructions: z.string().optional(),
      instrumental: z.boolean().optional(),
      duration: z.number().optional(),
      videoSourceMediaRef: z.string().optional(),
      videoSourceStartFrame: z.number().int().optional(),
      videoSourceEndFrame: z.number().int().optional(),
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
        videoSourceMediaRef?: string;
        videoSourceStartFrame?: number;
        videoSourceEndFrame?: number;
        confirm?: boolean;
      };

      if (!ctx.generation) return errorResult("generation is not available in this context");
      if (!(await ctx.generation.hasKey().catch(() => false))) return keyMissingError("generate audio");

      const entry = genModel(a.model);
      if (!entry || entry.kind !== "audio") return unknownModelError(a.model, "audio");

      const hasMediaRef = a.videoSourceMediaRef !== undefined;
      const hasStart = a.videoSourceStartFrame !== undefined;
      const hasEnd = a.videoSourceEndFrame !== undefined;
      if (hasMediaRef && (hasStart || hasEnd)) {
        return errorResult("videoSourceMediaRef is mutually exclusive with videoSourceStartFrame/videoSourceEndFrame.");
      }
      if (hasStart !== hasEnd) {
        return errorResult("videoSourceStartFrame and videoSourceEndFrame must be provided together.");
      }

      const acceptsVideo = entry.caps.acceptsVideo === true;
      let spanSeconds: number | undefined;
      let placement: { startFrame: number; frameCount: number } | undefined;
      let mediaRefSource: string | undefined;

      if (hasMediaRef) {
        if (!acceptsVideo) return errorResult(`Model '${entry.id}' does not accept a video input (see list_models 'inputs').`);
        const videoAsset = ctx.getManifest().entries.find((e) => e.id === a.videoSourceMediaRef);
        if (!videoAsset) return errorResult(`Video source not found: ${a.videoSourceMediaRef}`);
        if (videoAsset.type !== "video") {
          return errorResult(`videoSourceMediaRef must be a video asset (got ${videoAsset.type}).`);
        }
        spanSeconds = videoAsset.duration;
        mediaRefSource = a.videoSourceMediaRef;
      } else if (hasStart && hasEnd) {
        if (!acceptsVideo) return errorResult(`Model '${entry.id}' does not accept a video input (see list_models 'inputs').`);
        const start = a.videoSourceStartFrame!;
        const end = a.videoSourceEndFrame!;
        if (start < 0 || end <= start) {
          return errorResult("videoSourceEndFrame must be greater than videoSourceStartFrame (>= 0).");
        }
        const tl = ctx.store.getSnapshot().timeline;
        const totalFrames = timelineTotalFrames(tl);
        if (end > totalFrames) {
          return errorResult(`videoSourceEndFrame ${end} is beyond the timeline's end frame (${totalFrames}).`);
        }
        spanSeconds = (end - start) / Math.max(1, tl.fps);
        placement = { startFrame: start, frameCount: end - start };
      }

      if (entry.caps.requiresVideo && spanSeconds === undefined) {
        return errorResult(
          `Model '${entry.id}' generates audio from video. Provide videoSourceStartFrame + videoSourceEndFrame (a timeline span) or videoSourceMediaRef.`,
        );
      }

      // Swift's TTS/music placeholder-duration heuristic (Defaults.audio{TTS,Music}DurationSeconds),
      // extended for a video source: the span/asset length drives it, like Swift's spanSeconds.
      // Resolved BEFORE the estimate so a future duration-priced audio model can't bypass the gate.
      const duration = a.duration ?? (spanSeconds !== undefined ? Math.max(1, Math.round(spanSeconds)) : entry.caps.supportsLyrics ? 60 : 10);
      const params: GenToolParams = {
        prompt: a.prompt,
        voice: a.voice,
        lyrics: a.lyrics,
        instrumental: a.instrumental,
        duration,
      };

      const validationError = validateGenParams(entry, params);
      if (validationError) return errorResult(validationError);

      const estimate = estimateCredits(entry, params);
      if (estimate > ctx.generation.confirmThreshold && !a.confirm) return confirmationResult(estimate);

      // Resolve the video source — upload the media-ref file, or render+upload the timeline span —
      // only AFTER the cost gate. A rejected (unconfirmed) estimate must not pay for that work.
      if (mediaRefSource) {
        if (!ctx.generation.entryUrl) return errorResult("media upload not available yet");
        const url = await ctx.generation.entryUrl(mediaRefSource);
        if (!url) return errorResult("Could not read the video source file.");
        params.videoUrl = url;
      } else if (placement) {
        if (!ctx.generation.renderSpanToMp4) return errorResult("Timeline span rendering is not available in this context.");
        if (!ctx.generation.uploadFile) return errorResult("Media upload is not available in this context.");
        const bytes = await ctx.generation.renderSpanToMp4(placement.startFrame, placement.frameCount, 360);
        params.videoUrl = await ctx.generation.uploadFile(bytes, "video/mp4", `span-${ctx.newId()}.mp4`);
      }

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

      if (placement) {
        const { startFrame, frameCount } = placement;
        return submit(ctx.generation, entry, input, placeholder, estimate, "Generation started.", () => {
          placeGeneratingAudioClip(ctx.store, ctx.newId, placeholder, startFrame, frameCount, `Add ${audioCategoryLabel(entry)}`);
          return `Generation started and placed on the timeline at frame ${startFrame}. Placeholder asset ID: ${placeholder.id}. Model: ${entry.displayName}, ${audioCategoryLabel(entry)} (scored from video). Estimated cost: ${formatCredits(estimate)}.`;
        });
      }

      return submit(ctx.generation, entry, input, placeholder, estimate, "Generation started.");
    },
  };
}
