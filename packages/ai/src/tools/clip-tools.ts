import { z } from "zod";
import { findClip, addClipCommand, moveClipCommand, splitLinkedClipCommand, trimClipCommand, removeClipCommand, clipTypesCompatible, clipEndFrame, planAgentResolutionAdoption } from "@palmier/core";
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

      // Resolution auto-match (#233 standing rule: fps is never adopted here) — a separate undo
      // step ahead of the add, mirroring Swift's applySettingsIfNeededForAgent/checkProjectSettings.
      const adoption = planAgentResolutionAdoption(tl, manifest, entries.map((e) => e.entry));
      if (adoption.command) ctx.store.dispatch(adoption.command);

      const newIds: string[] = [];
      const commands = entries.map(({ entry, trackIndex, startFrame }) => {
        const target =
          trackIndex !== undefined
            ? ({ kind: "existing" as const, index: trackIndex })
            : ({ kind: "new" as const, index: 0 });
        const id = ctx.newId();
        newIds.push(id);
        // addClipCommand calls newId() once per entity (visual clip, linkGroupId, new track,
        // linked audio clip, audio track). The visual clip must carry the reported id; every
        // other entity must get its own — a constant thunk collapses them, colliding the linked
        // audio's id with the video's and desyncing later split/move/remove. (Snapshot-based
        // undo applies once, so a stateful first-call thunk is safe.)
        let firstCall = true;
        const genId = () => {
          if (firstCall) { firstCall = false; return id; }
          return ctx.newId();
        };
        return addClipCommand(entry, target, startFrame, fps, undefined, genId);
      });

      asUndoStep(ctx.store, "Add Clips", commands.map((cmd) => cmd.apply.bind(cmd)));

      const prefix = adoption.note ? `${adoption.note} ` : "";
      return ok(`${prefix}Added ${newIds.length} clip(s): ${newIds.join(", ")}`);
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

      // splitLinkedClipCommand splits the target AND its linked partners; its first newId() call
      // is the target clip's right-half id — the one to report.
      let newClipId = "";
      let firstCall = true;
      const genId = () => {
        const id = ctx.newId();
        if (firstCall) { firstCall = false; newClipId = id; }
        return id;
      };
      const cmd = splitLinkedClipCommand(clipId, atFrame, undefined, genId);
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

export function splitClipsTool(): ToolSpec {
  return {
    name: "split_clips",
    description: "Splits one or more clips, each at a given frame. Each split keeps the left half's id and creates a new right-half clip. All splits are a single undo step.",
    inputSchema: z.object({
      splits: z.array(z.object({ clipId: z.string(), atFrame: z.number().int() })).min(1),
    }),
    run(args, ctx) {
      const { splits } = args as { splits: { clipId: string; atFrame: number }[] };
      const tl = ctx.store.getSnapshot().timeline;
      for (const s of splits) {
        const loc = findClip(tl, s.clipId);
        if (!loc) return errorResult(`unknown clip: ${s.clipId}`);
        const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
        const end = clipEndFrame(clip);
        if (s.atFrame <= clip.startFrame || s.atFrame >= end)
          return errorResult(`atFrame ${s.atFrame} must be strictly inside clip ${s.clipId} (frames ${clip.startFrame}..${end})`);
      }
      // Each split carries its linked partners; capture each split's target right-half id (its
      // first newId() call) for the report.
      const primaries: { value: string }[] = [];
      const reducers = splits.map((s) => {
        const holder = { value: "" };
        primaries.push(holder);
        let firstCall = true;
        const genId = () => {
          const id = ctx.newId();
          if (firstCall) { firstCall = false; holder.value = id; }
          return id;
        };
        const cmd = splitLinkedClipCommand(s.clipId, s.atFrame, undefined, genId);
        return cmd.apply.bind(cmd);
      });
      asUndoStep(ctx.store, splits.length > 1 ? "Split Clips" : "Split Clip", reducers);
      const newIds = primaries.map((p) => p.value);
      return ok(`Split ${splits.length} clip(s). New ids: ${newIds.join(", ")}`);
    },
  };
}
