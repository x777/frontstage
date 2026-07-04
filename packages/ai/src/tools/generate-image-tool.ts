import { z } from "zod";
import type { GenerationInput, MediaManifestEntry } from "@palmier/core";
import { createPlaceholderEntry } from "@palmier/core";
import type { ToolResult, ToolSpec, ToolContext } from "./types.js";
import { ok, errorResult } from "./executor.js";
import { genModel, listGenModels, validateGenParams, referenceCapError } from "../generation/gen-catalog.js";
import type { GenToolParams } from "../generation/gen-catalog.js";
import { estimateCredits, formatCredits } from "../generation/cost-estimator.js";
import { unknownModelError, confirmationResult } from "./generate-tools.js";

const IMAGE_DURATION_SECONDS = 5; // mirrors Swift's Defaults.imageDurationSeconds

type Generation = NonNullable<ToolContext["generation"]>;

async function runImagePipeline(
  a: { prompt: string; model?: string; numImages?: number; confirm?: boolean; referenceMediaIds?: string[] },
  generation: Generation,
  ctx: ToolContext,
): Promise<ToolResult> {
  const modelId = a.model ?? listGenModels("image")[0]?.id;
  const entry = modelId ? genModel(modelId) : undefined;
  if (!entry || entry.kind !== "image") return unknownModelError(a.model ?? modelId ?? "", "image");

  const numImages = Math.max(1, Math.min(4, a.numImages ?? 1));
  const params: GenToolParams = { prompt: a.prompt, numImages };

  const validationError = validateGenParams(entry, params);
  if (validationError) return errorResult(validationError);

  // Reject fast (no network calls) when the model's real fal endpoint has no image field at all
  // (maxReferenceImages: 0 — see gen-catalog.ts's verification note), same as generate_video.
  const refIds = a.referenceMediaIds ?? [];
  if (refIds.length > 0) {
    const capError = referenceCapError(entry, refIds.length);
    if (capError) return errorResult(capError);
  }

  const estimate = estimateCredits(entry, params);
  if (estimate > generation.confirmThreshold && !a.confirm) return confirmationResult(estimate);

  if (refIds.length > 0 && generation.entryUrl) {
    const refs: string[] = [];
    for (const id of refIds) {
      const url = await generation.entryUrl(id);
      if (url) refs.push(url);
    }
    if (refs.length > 0) params.imageUrls = refs;
  }

  const input = entry.buildInput(params);
  const baseName = a.prompt.slice(0, 24);

  const placeholders: MediaManifestEntry[] = [];
  for (let i = 0; i < numImages; i++) {
    const genInput: GenerationInput = {
      prompt: a.prompt,
      model: entry.endpoint,
      duration: IMAGE_DURATION_SECONDS,
      aspectRatio: "",
      numImages,
      outputIndex: i,
      createdAt: new Date().toISOString(),
    };
    placeholders.push(
      createPlaceholderEntry({
        id: ctx.newId(),
        type: "image",
        name: `${baseName} ${i + 1}`,
        duration: IMAGE_DURATION_SECONDS,
        ext: "png",
        genInput,
      }),
    );
  }

  for (const placeholder of placeholders) generation.addPlaceholder(placeholder);

  const result = await generation.startJob({
    modelEndpoint: entry.endpoint,
    input,
    placeholders,
    model: entry.endpoint,
    costCredits: estimate,
  });
  if ("error" in result) return errorResult(result.error);

  const primary = placeholders[0]!;
  return ok(
    `Generation started. Placeholder asset ID: ${primary.id}. ${numImages} image(s) will appear in the media library when ready. Estimated cost: ${formatCredits(estimate)}.`,
  );
}

export function generateImageTool(): ToolSpec {
  return {
    name: "generate_image",
    description:
      "Generates image(s) from a text prompt using AI and adds them to the media library. When a fal.ai key is configured, runs as an async background generation (call list_models kind='image' first to pick a model): returns a placeholder asset ID immediately, numImages (1-4) generates a batch from one prompt, and it costs real money and is not undoable. Without a configured fal.ai key, falls back to a synchronous single-image generation.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      // Resolved through the pipeline path only (fal key configured) — rejected cleanly per-model
      // via maxReferenceImages (currently 0 for every catalogued image model; see gen-catalog.ts).
      referenceMediaIds: z.array(z.string()).optional(),
      model: z.string().optional(),
      numImages: z.number().int().optional(),
      confirm: z.boolean().optional(),
    }),
    async run(args, ctx) {
      const a = args as {
        prompt: string;
        referenceMediaIds?: string[];
        model?: string;
        numImages?: number;
        confirm?: boolean;
      };

      // A rejecting hasKey (e.g. unreachable proxy) must fall back to the legacy path, not error.
      if (ctx.generation && (await ctx.generation.hasKey().catch(() => false))) {
        return runImagePipeline(a, ctx.generation, ctx);
      }

      if (!ctx.generateImage) return errorResult("image generation is not available");

      try {
        const entry = await ctx.generateImage({ prompt: a.prompt });
        return ok(`Generated image "${entry.name}" (id ${entry.id}) and added it to the media library.`);
      } catch (err) {
        return errorResult("image generation failed: " + String(err));
      }
    },
  };
}
