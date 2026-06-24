import { z } from "zod";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

export function generateImageTool(): ToolSpec {
  return {
    name: "generate_image",
    description: "Generates an image from a text prompt using AI and adds it to the media library.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      // referenceMediaIds resolution to base64 is DEFERRED — ignored in plan 6.5
      referenceMediaIds: z.array(z.string()).optional(),
    }),
    async run(args, ctx) {
      const { prompt } = args as { prompt: string; referenceMediaIds?: string[] };

      if (!ctx.generateImage) return errorResult("image generation is not available");

      try {
        const entry = await ctx.generateImage({ prompt });
        return ok(`Generated image "${entry.name}" (id ${entry.id}) and added it to the media library.`);
      } catch (err) {
        return errorResult("image generation failed: " + String(err));
      }
    },
  };
}
