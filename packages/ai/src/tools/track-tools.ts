import { z } from "zod";
import { removeTrackCommand } from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

export function removeTracksTool(): ToolSpec {
  return {
    name: "remove_tracks",
    description: "Removes one or more tracks from the timeline by id. All removals are one undo step.",
    inputSchema: z.object({
      trackIds: z.array(z.string()).min(1),
    }),
    run(args, ctx) {
      const { trackIds } = args as { trackIds: string[] };
      const tl = ctx.store.getSnapshot().timeline;

      for (const id of trackIds) {
        if (!tl.tracks.find((t) => t.id === id)) return errorResult(`unknown track: ${id}`);
      }

      asUndoStep(
        ctx.store,
        "Remove Tracks",
        trackIds.map((id) => { const cmd = removeTrackCommand(id); return cmd.apply.bind(cmd); }),
      );

      return ok(`Removed ${trackIds.length} track(s): ${trackIds.join(", ")}`);
    },
  };
}
