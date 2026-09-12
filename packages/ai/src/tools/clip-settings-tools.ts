import { z } from "zod";
import { applyClipSettings, clipEndFrame, findClip } from "@frontstage/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

const DESCRIPTION =
  "Copy one clip's static settings to one or more clips of the same media type in a single undoable action. Use for requests such as \"make these shots look like that one,\" \"use this title style,\" or \"give these audio clips the same treatment.\"\n\n" +
  "Choose exactly one target mode. targetClipIds applies to an explicit list and refuses any mismatched media type. targetTrack selects every same-type clip on one stable trackId; add range [startFrame, endFrame) to limit it to clips intersecting that part of the timeline. Track mode excludes the source and mismatched clips, returns compact matched/changed/unchanged/incompatible counts instead of clip IDs, and refuses when no compatible clips match.\n\n" +
  "Video, image, Lottie, and nested-timeline clips copy transform, crop, opacity, blend mode, and the complete effect stack including color. Text clips copy typography/style, text animation, fill mode, position, rotation, flips, opacity, and effects; target text, word timings, and caption membership stay intact. Audio clips copy volume and effects. Settings absent from the source clear the corresponding target setting.\n\n" +
  "This does NOT copy placement, duration, trims, speed, fades, top-level keyframes, media, links, or caption groups. Use set_clip_properties and set_keyframes for temporal changes. Linked audio is a separate audio clip: copy it explicitly.";

export function copyClipSettingsTool(): ToolSpec {
  return {
    name: "copy_clip_settings",
    description: DESCRIPTION,
    inputSchema: z.object({
      sourceClipId: z.string(),
      targetClipIds: z.array(z.string()).optional(),
      targetTrack: z
        .object({
          trackId: z.string(),
          range: z.array(z.number().int()).length(2).optional(),
        })
        .optional(),
    }),
    run(args, ctx) {
      const { sourceClipId, targetClipIds: explicitIds, targetTrack } = args as {
        sourceClipId: string;
        targetClipIds?: string[];
        targetTrack?: { trackId: string; range?: number[] };
      };

      if ((explicitIds != null) === (targetTrack != null)) {
        return errorResult("Provide exactly one of 'targetClipIds' or 'targetTrack'");
      }

      const tl = ctx.store.getSnapshot().timeline;
      const sourceLoc = findClip(tl, sourceClipId);
      if (!sourceLoc) return errorResult(`Clip not found: ${sourceClipId}`);
      const source = tl.tracks[sourceLoc.trackIndex]!.clips[sourceLoc.clipIndex]!;

      let targetClipIds: string[];
      let targetSelection: { trackId: string; range?: number[] } | undefined;
      let incompatibleClipCount = 0;
      let sourceExcluded = false;

      if (explicitIds) {
        const seen = new Set<string>();
        targetClipIds = explicitIds.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (targetClipIds.length === 0) return errorResult("Provide a non-empty 'targetClipIds' array");
      } else {
        const track = tl.tracks.find((t) => t.id === targetTrack!.trackId);
        if (!track) return errorResult(`Track not found: ${targetTrack!.trackId}`);
        const frames = targetTrack!.range;
        if (frames) {
          if (frames.length !== 2 || frames[0]! < 0 || frames[1]! <= frames[0]!) {
            return errorResult("targetTrack.range must be [startFrame, endFrame) with 0 <= startFrame < endFrame");
          }
        }
        const range = frames ? { start: frames[0]!, end: frames[1]! } : undefined;
        const scoped = track.clips.filter((c) =>
          range ? c.startFrame < range.end && clipEndFrame(c) > range.start : true,
        );
        targetClipIds = scoped
          .filter((c) => c.id !== sourceClipId && c.mediaType === source.mediaType)
          .map((c) => c.id);
        sourceExcluded = scoped.some((c) => c.id === sourceClipId);
        incompatibleClipCount = scoped.filter(
          (c) => c.id !== sourceClipId && c.mediaType !== source.mediaType,
        ).length;
        if (targetClipIds.length === 0) {
          return errorResult(`No ${source.mediaType} clips matched targetTrack ${targetTrack!.trackId}`);
        }
        targetSelection = { trackId: targetTrack!.trackId };
        if (frames) targetSelection.range = frames;
      }

      const transfer = applyClipSettings(tl, sourceClipId, targetClipIds);
      if (!transfer.ok) return errorResult(transfer.message);

      if (transfer.result.changedClipIds.length > 0) {
        ctx.store.dispatch({
          label: "Copy Clip Settings",
          apply: (t) => {
            const next = applyClipSettings(t, sourceClipId, targetClipIds);
            return next.ok ? next.timeline : t;
          },
        });
      }

      const extra: Record<string, unknown> = {
        changed: transfer.result.changedClipIds.length > 0,
        sourceClipId,
        mediaType: transfer.result.mediaType,
      };
      if (targetSelection) {
        extra.targetTrack = targetSelection;
        extra.matchedClipCount = targetClipIds.length;
        extra.changedClipCount = transfer.result.changedClipIds.length;
        extra.unchangedClipCount = transfer.result.unchangedClipIds.length;
        extra.incompatibleClipCount = incompatibleClipCount;
        extra.sourceExcluded = sourceExcluded;
      } else {
        extra.targetClipIds = targetClipIds;
        extra.changedClipIds = transfer.result.changedClipIds;
        extra.unchangedClipIds = transfer.result.unchangedClipIds;
      }
      return ok(JSON.stringify(extra, null, 2));
    },
  };
}
