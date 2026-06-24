import { z } from "zod";
import { findClip, addClipCommand, moveClipCommand, splitClipCommand, trimClipCommand, removeClipCommand } from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

export function addClipsTool(): ToolSpec {
  return {
    name: "add_clips",
    description: "Adds one or more clips to the timeline. Each clip references a media entry by id. All clips are added as a single undo step.",
    inputSchema: z.object({
      clips: z.array(
        z.object({
          mediaId: z.string(),
          trackIndex: z.number().int().optional(),
          startFrame: z.number().int(),
        }),
      ).min(1),
    }),
    run(args, ctx) {
      const { clips } = args as { clips: { mediaId: string; trackIndex?: number; startFrame: number }[] };
      const manifest = ctx.getManifest();
      const fps = ctx.store.getSnapshot().timeline.fps;

      // Validate all before touching the store
      const entries = [];
      for (const c of clips) {
        const entry = manifest.entries.find((e) => e.id === c.mediaId);
        if (!entry) return errorResult(`unknown media: ${c.mediaId}`);
        entries.push({ entry, trackIndex: c.trackIndex, startFrame: c.startFrame });
      }

      const reducers = entries.map(({ entry, trackIndex, startFrame }) => {
        const target =
          trackIndex !== undefined
            ? ({ kind: "existing" as const, index: trackIndex })
            : ({ kind: "new" as const, index: 0 });
        const id = ctx.newId();
        return addClipCommand(entry, target, startFrame, fps, undefined, () => id).apply.bind(
          addClipCommand(entry, target, startFrame, fps, undefined, () => id),
        );
      });

      // Rebuild reducers properly — bind .apply from the command objects
      const commands = entries.map(({ entry, trackIndex, startFrame }) => {
        const target =
          trackIndex !== undefined
            ? ({ kind: "existing" as const, index: trackIndex })
            : ({ kind: "new" as const, index: 0 });
        const id = ctx.newId();
        return addClipCommand(entry, target, startFrame, fps, undefined, () => id);
      });

      asUndoStep(ctx.store, "Add Clips", commands.map((cmd) => cmd.apply.bind(cmd)));

      // Collect the new clip ids from the snapshot
      const tl = ctx.store.getSnapshot().timeline;
      const allClipIds: string[] = tl.tracks.flatMap((t) => t.clips.map((c) => c.id));
      return ok(`Added ${commands.length} clip(s). Clip ids in timeline: ${allClipIds.join(", ")}`);
    },
  };
}

export function removeClipsTool(): ToolSpec {
  return {
    name: "remove_clips",
    description: "Removes one or more clips from the timeline by id. All removals are one undo step.",
    inputSchema: z.object({
      clipIds: z.array(z.string()).min(1),
    }),
    run(args, ctx) {
      const { clipIds } = args as { clipIds: string[] };
      const tl = ctx.store.getSnapshot().timeline;

      // Validate all before touching the store
      for (const id of clipIds) {
        if (!findClip(tl, id)) return errorResult(`unknown clip: ${id}`);
      }

      asUndoStep(
        ctx.store,
        "Remove Clips",
        clipIds.map((id) => removeClipCommand(id).apply.bind(removeClipCommand(id))),
      );

      return ok(`Removed ${clipIds.length} clip(s): ${clipIds.join(", ")}`);
    },
  };
}

export function moveClipsTool(): ToolSpec {
  return {
    name: "move_clips",
    description: "Moves one or more clips to new track/frame positions. All moves are one undo step.",
    inputSchema: z.object({
      moves: z.array(
        z.object({
          clipId: z.string(),
          toTrackIndex: z.number().int(),
          toStartFrame: z.number().int(),
        }),
      ).min(1),
    }),
    run(args, ctx) {
      const { moves } = args as { moves: { clipId: string; toTrackIndex: number; toStartFrame: number }[] };
      const tl = ctx.store.getSnapshot().timeline;

      for (const m of moves) {
        if (!findClip(tl, m.clipId)) return errorResult(`unknown clip: ${m.clipId}`);
      }

      asUndoStep(
        ctx.store,
        "Move Clips",
        moves.map((m) => moveClipCommand(m.clipId, m.toTrackIndex, m.toStartFrame).apply.bind(
          moveClipCommand(m.clipId, m.toTrackIndex, m.toStartFrame),
        )),
      );

      return ok(`Moved ${moves.length} clip(s).`);
    },
  };
}

export function splitClipTool(): ToolSpec {
  return {
    name: "split_clip",
    description: "Splits a clip at the given frame, producing two clips. This is one undo step.",
    inputSchema: z.object({
      clipId: z.string(),
      atFrame: z.number().int(),
    }),
    run(args, ctx) {
      const { clipId, atFrame } = args as { clipId: string; atFrame: number };
      const tl = ctx.store.getSnapshot().timeline;

      if (!findClip(tl, clipId)) return errorResult(`unknown clip: ${clipId}`);

      const cmd = splitClipCommand(clipId, atFrame, undefined, ctx.newId);
      asUndoStep(ctx.store, "Split Clip", [cmd.apply.bind(cmd)]);

      const after = ctx.store.getSnapshot().timeline;
      const allIds = after.tracks.flatMap((t) => t.clips.map((c) => c.id));
      return ok(`Split clip ${clipId} at frame ${atFrame}. Clips: ${allIds.join(", ")}`);
    },
  };
}

export function trimClipsTool(): ToolSpec {
  return {
    name: "trim_clips",
    description: "Trims one or more clips by adjusting their left or right edge by deltaFrames. All trims are one undo step.",
    inputSchema: z.object({
      trims: z.array(
        z.object({
          clipId: z.string(),
          edge: z.enum(["left", "right"]),
          deltaFrames: z.number().int(),
        }),
      ).min(1),
    }),
    run(args, ctx) {
      const { trims } = args as { trims: { clipId: string; edge: "left" | "right"; deltaFrames: number }[] };
      const tl = ctx.store.getSnapshot().timeline;

      for (const tr of trims) {
        if (!findClip(tl, tr.clipId)) return errorResult(`unknown clip: ${tr.clipId}`);
      }

      asUndoStep(
        ctx.store,
        "Trim Clips",
        trims.map((tr) => trimClipCommand(tr.clipId, tr.edge, tr.deltaFrames).apply.bind(
          trimClipCommand(tr.clipId, tr.edge, tr.deltaFrames),
        )),
      );

      return ok(`Trimmed ${trims.length} clip(s).`);
    },
  };
}
