import { z } from "zod";
import { findClip, rippleDeleteRangesOnTrack, rippleInsertClipsSpecs, resolvePlacement, type FrameRange, type RippleInsertSpec } from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

export function rippleDeleteRangesTool(): ToolSpec {
  return {
    name: "ripple_delete_ranges",
    description: "Ripple-deletes frame ranges on a track: cuts the ranges and shifts later clips (and non-ignored sync-locked tracks) left to close the gaps. Refuses if a sync-locked track would collide.",
    inputSchema: z.object({
      trackIndex: z.number().int().optional(),
      anchorClipId: z.string().optional(),
      ranges: z.array(z.object({ start: z.number().finite(), end: z.number().finite() })).min(1),
      unit: z.enum(["frames", "seconds"]).optional(),
      ignoreSyncLockedTracks: z.boolean().optional(),
    }),
    run(args, ctx) {
      const a = args as {
        trackIndex?: number; anchorClipId?: string;
        ranges: { start: number; end: number }[];
        unit?: "frames" | "seconds"; ignoreSyncLockedTracks?: boolean;
      };
      const tl = ctx.store.getSnapshot().timeline;
      const fps = tl.fps;

      let trackIndex = a.trackIndex;
      if (trackIndex === undefined) {
        if (!a.anchorClipId) return errorResult("provide trackIndex or anchorClipId");
        const loc = findClip(tl, a.anchorClipId);
        if (!loc) return errorResult(`unknown clip: ${a.anchorClipId}`);
        trackIndex = loc.trackIndex;
      }
      if (trackIndex < 0 || trackIndex >= tl.tracks.length) return errorResult(`trackIndex ${trackIndex} out of range`);

      const toFrames = (n: number) => (a.unit === "seconds" ? Math.round(n * fps) : Math.round(n));
      const ranges: FrameRange[] = a.ranges.map((r) => ({ start: toFrames(r.start), end: toFrames(r.end) }));
      const ignore = a.ignoreSyncLockedTracks
        ? new Set(tl.tracks.map((t, i) => (t.syncLocked ? i : -1)).filter((i) => i >= 0))
        : new Set<number>();

      const out = rippleDeleteRangesOnTrack(tl, trackIndex, ranges, ignore);
      if (out.kind === "refused") return errorResult(`ripple delete refused: ${out.reason}`);

      const ti = trackIndex;
      asUndoStep(ctx.store, "Ripple Delete Ranges", [(t) => {
        const ig = a.ignoreSyncLockedTracks
          ? new Set(t.tracks.map((tr, i) => (tr.syncLocked ? i : -1)).filter((i) => i >= 0))
          : new Set<number>();
        const o = rippleDeleteRangesOnTrack(t, ti, ranges, ig);
        return o.kind === "ok" ? o.timeline : t;
      }]);

      const r = out.report;
      return ok(
        `Ripple-deleted ${r.removedFrames} frame(s) across ${r.clearedTracks} track(s); ` +
          `${r.removedClipIds.length} clip(s) removed, ${r.shiftedClips} shifted. ` +
          `Anchor track now has ${r.resultingFragments.length} clip(s).`,
      );
    },
  };
}

export function insertClipsTool(): ToolSpec {
  return {
    name: "insert_clips",
    description: "Ripple-inserts clips at a frame on a track: opens a gap (pushing later clips and sync-locked + linked-audio tracks right), then drops the clips in. Each references a media entry by id. durationFrames and trimStartFrame/trimEndFrame are optional: durationFrames is the timeline length, trimStartFrame/trimEndFrame trim the source's head/tail. Omit durationFrames to derive it from the source; durationFrames and trimEndFrame are mutually exclusive (both pin the clip's end). Omit all three to use the full source. Untrimmed source stays as headroom, so the clip can later be extended.",
    inputSchema: z.object({
      trackIndex: z.number().int(),
      atFrame: z.number().int(),
      clips: z.array(z.object({
        mediaId: z.string(),
        durationFrames: z.number().int().optional(),
        trimStartFrame: z.number().int().optional(),
        trimEndFrame: z.number().int().optional(),
      })).min(1),
    }),
    run(args, ctx) {
      const a = args as {
        trackIndex: number; atFrame: number;
        clips: { mediaId: string; durationFrames?: number; trimStartFrame?: number; trimEndFrame?: number }[];
      };
      const tl = ctx.store.getSnapshot().timeline;
      const fps = tl.fps;
      if (a.trackIndex < 0 || a.trackIndex >= tl.tracks.length) return errorResult(`trackIndex ${a.trackIndex} out of range`);

      const manifest = ctx.getManifest();
      const specs: RippleInsertSpec[] = [];
      for (let idx = 0; idx < a.clips.length; idx++) {
        const c = a.clips[idx]!;
        const entry = manifest.entries.find((e) => e.id === c.mediaId);
        if (!entry) return errorResult(`unknown media: ${c.mediaId}`);
        const sourceLen = Math.round(entry.duration * fps);
        const place = resolvePlacement(sourceLen, c.trimStartFrame ?? 0, c.durationFrames, c.trimEndFrame);
        if ("error" in place) return errorResult(`clips[${idx}]: ${place.error}`);
        specs.push({ entry, durationFrames: place.duration, trimStartFrame: place.trimStart, trimEndFrame: place.trimEnd });
      }

      const base = ctx.newId();
      const ti = a.trackIndex;
      const at = a.atFrame;
      asUndoStep(ctx.store, "Insert Clips", [(t) => {
        let n = 0;
        const detId = () => `${base}-${n++}`;
        return rippleInsertClipsSpecs(t, specs, ti, at, fps, detId).timeline;
      }]);

      return ok(`Inserted ${specs.length} clip(s) at frame ${at} on track ${ti} (ripple).`);
    },
  };
}
