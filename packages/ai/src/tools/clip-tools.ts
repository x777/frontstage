import { z } from "zod";
import { findClip, addClipCommand, moveClipCommand, splitClipCommand, trimClipCommand, removeClipCommand, clipTypesCompatible } from "@palmier/core";
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
      const tl = ctx.store.getSnapshot().timeline;
      const fps = tl.fps;

      // Validate all before touching the store
      const entries = [];
      for (const c of clips) {
        const entry = manifest.entries.find((e) => e.id === c.mediaId);
        if (!entry) return errorResult(`unknown media: ${c.mediaId}`);
        if (c.trackIndex !== undefined) {
          if (c.trackIndex < 0 || c.trackIndex >= tl.tracks.length)
            return errorResult(`trackIndex ${c.trackIndex} out of range`);
          const track = tl.tracks[c.trackIndex]!;
          if (!clipTypesCompatible(track.type, entry.type))
            return errorResult(`media type "${entry.type}" incompatible with track type "${track.type}" at index ${c.trackIndex}`);
        }
        entries.push({ entry, trackIndex: c.trackIndex, startFrame: c.startFrame });
      }

      const newIds: string[] = [];
      const commands = entries.map(({ entry, trackIndex, startFrame }) => {
        const target =
          trackIndex !== undefined
            ? ({ kind: "existing" as const, index: trackIndex })
            : ({ kind: "new" as const, index: 0 });
        const id = ctx.newId();
        newIds.push(id);
        return addClipCommand(entry, target, startFrame, fps, undefined, () => id);
      });

      asUndoStep(ctx.store, "Add Clips", commands.map((cmd) => cmd.apply.bind(cmd)));

      return ok(`Added ${newIds.length} clip(s): ${newIds.join(", ")}`);
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
        clipIds.map((id) => { const cmd = removeClipCommand(id); return cmd.apply.bind(cmd); }),
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
        moves.map((m) => { const cmd = moveClipCommand(m.clipId, m.toTrackIndex, m.toStartFrame); return cmd.apply.bind(cmd); }),
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

      const loc = findClip(tl, clipId);
      if (!loc) return errorResult(`unknown clip: ${clipId}`);
      const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
      const clipEnd = clip.startFrame + clip.durationFrames;
      if (atFrame <= clip.startFrame || atFrame >= clipEnd)
        return errorResult(`atFrame ${atFrame} must be strictly inside the clip (frames ${clip.startFrame}..${clipEnd})`);

      let newClipId = "";
      const cmd = splitClipCommand(clipId, atFrame, undefined, () => { newClipId = ctx.newId(); return newClipId; });
      asUndoStep(ctx.store, "Split Clip", [cmd.apply.bind(cmd)]);

      return ok(`Split clip ${clipId} at frame ${atFrame}. New clip id: ${newClipId}`);
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
        trims.map((tr) => { const cmd = trimClipCommand(tr.clipId, tr.edge, tr.deltaFrames); return cmd.apply.bind(cmd); }),
      );

      return ok(`Trimmed ${trims.length} clip(s).`);
    },
  };
}
