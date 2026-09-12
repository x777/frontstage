import { z } from "zod";
import { applySwapClipMedia, planSwapClipMedia } from "@frontstage/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

const DESCRIPTION =
  "Replace a clip's source with another library asset while preserving its edit, timing, framing, effects, and keyframes. " +
  "Linked video/audio clips that share the source are updated together. The replacement must have the same source type, " +
  "contain audio when a linked audio clip needs it, and cover the current source range; extra tail remains available for trimming. " +
  "Text and nested timeline clips are refused.";

export function swapClipMediaTool(): ToolSpec {
  return {
    name: "swap_clip_media",
    description: DESCRIPTION,
    inputSchema: z.object({
      clipId: z.string(),
      mediaRef: z.string(),
    }),
    run(args, ctx) {
      const { clipId, mediaRef } = args as { clipId: string; mediaRef: string };
      const replacement = ctx.getManifest().entries.find((e) => e.id === mediaRef);
      if (!replacement) return errorResult(`unknown media: ${mediaRef}`);

      const tl = ctx.store.getSnapshot().timeline;
      const planned = planSwapClipMedia(tl, clipId, replacement);
      if (!planned.ok) return errorResult(planned.message);

      const { plan } = planned;
      if (plan.changed) {
        ctx.store.dispatch({
          label: "Replace Clip Source",
          apply: (t) => applySwapClipMedia(t, plan),
        });
      }

      return ok(
        JSON.stringify(
          {
            changed: plan.changed,
            clipId: plan.clipId,
            oldMediaRef: plan.oldMediaRef,
            mediaRef: plan.newMediaRef,
            affectedClipIds: plan.affectedClipIds,
          },
          null,
          2,
        ),
      );
    },
  };
}
