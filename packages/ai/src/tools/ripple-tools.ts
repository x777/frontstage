import { z } from "zod";
import { findClip, rippleDeleteRangesOnTrack, type FrameRange } from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

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
      ctx.store.dispatch({
        label: "Ripple Delete Ranges",
        apply: (t) => {
          const o = rippleDeleteRangesOnTrack(t, ti, ranges, ignore);
          return o.kind === "ok" ? o.timeline : t;
        },
      });

      const r = out.report;
      return ok(
        `Ripple-deleted ${r.removedFrames} frame(s) across ${r.clearedTracks} track(s); ` +
          `${r.removedClipIds.length} clip(s) removed, ${r.shiftedClips} shifted. ` +
          `Anchor track now has ${r.resultingFragments.length} clip(s).`,
      );
    },
  };
}
