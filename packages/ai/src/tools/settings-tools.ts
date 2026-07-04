import { z } from "zod";
import {
  applyTimelineSettingsCommand,
  ASPECT_RATIO_PRESETS,
  QUALITY_PRESET_SHORT_EDGE,
  qualityResolution,
} from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

// Ported from Swift ToolExecutor+ProjectSettings.swift's `setProjectSettings` (#177). Validation
// order and messages are Swift-verbatim. #233 note (report-bound, not ported here): Swift's
// add_clips/insert_clips auto-match resolution (not fps) to the first clip when the timeline is
// empty/unconfigured — TS's add_clips has no adoption step at all yet (see layout-tools.ts), so
// there is nothing to align there besides the already-true fps exception this tool enforces: fps
// changes ONLY from this tool's explicit `fps` argument, never implicitly.

const ASPECT_RATIO_NAMES = "16:9, 9:16, 1:1, 4:3, 2.4:1, 9:14";
const QUALITY_NAMES = "720p, 1080p, 2K, 4K";

interface SetProjectSettingsArgs {
  fps?: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  quality?: string;
}

export function setProjectSettingsTool(): ToolSpec {
  return {
    name: "set_project_settings",
    description:
      "Change the project's frame rate, resolution, or aspect ratio. Pass any combination of fps, explicit width+height, aspectRatio, and quality. aspectRatio and explicit width/height are mutually exclusive; quality scales the current aspect ratio (or the selected preset when combined with aspectRatio). The timeline's existing clips are re-fitted automatically: auto-fit transforms recalculate for the new canvas size, and all frame positions/durations rescale when fps changes. Undoable.",
    inputSchema: z.object({
      fps: z.number().int().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      aspectRatio: z.string().optional(),
      quality: z.string().optional(),
    }),
    run(args, ctx) {
      const a = args as SetProjectSettingsArgs;

      if (
        a.fps === undefined &&
        a.width === undefined &&
        a.height === undefined &&
        a.aspectRatio === undefined &&
        a.quality === undefined
      ) {
        return errorResult("Provide at least one of: fps, width, height, aspectRatio, quality");
      }
      if (a.aspectRatio !== undefined && (a.width !== undefined || a.height !== undefined)) {
        return errorResult("'aspectRatio' and explicit 'width'/'height' are mutually exclusive");
      }
      if (a.fps !== undefined && (a.fps < 1 || a.fps > 120)) {
        return errorResult(`fps must be between 1 and 120 (got ${a.fps})`);
      }

      const aspectPreset = a.aspectRatio !== undefined ? ASPECT_RATIO_PRESETS[a.aspectRatio] : undefined;
      if (a.aspectRatio !== undefined && !aspectPreset) {
        return errorResult(`Unknown aspectRatio '${a.aspectRatio}'. Use one of: ${ASPECT_RATIO_NAMES}`);
      }
      const qualityShortEdge = a.quality !== undefined ? QUALITY_PRESET_SHORT_EDGE[a.quality] : undefined;
      if (a.quality !== undefined && qualityShortEdge === undefined) {
        return errorResult(`Unknown quality '${a.quality}'. Use one of: ${QUALITY_NAMES}`);
      }

      const tl = ctx.store.getSnapshot().timeline;
      const newFPS = a.fps ?? tl.fps;

      let newWidth: number;
      let newHeight: number;
      if (aspectPreset) {
        let baseW = aspectPreset.width;
        let baseH = aspectPreset.height;
        if (qualityShortEdge !== undefined) {
          const scaled = qualityResolution(qualityShortEdge, baseW, baseH);
          baseW = scaled.width;
          baseH = scaled.height;
        }
        newWidth = baseW;
        newHeight = baseH;
      } else if (qualityShortEdge !== undefined) {
        const scaled = qualityResolution(qualityShortEdge, tl.width, tl.height);
        newWidth = scaled.width;
        newHeight = scaled.height;
      } else {
        newWidth = a.width ?? tl.width;
        newHeight = a.height ?? tl.height;
      }

      if (newWidth <= 0 || newHeight <= 0) {
        return errorResult("Resolution must have positive width and height");
      }

      const prevFPS = tl.fps;
      const prevWidth = tl.width;
      const prevHeight = tl.height;

      const manifest = ctx.getManifest();
      const cmd = applyTimelineSettingsCommand(newFPS, newWidth, newHeight, manifest);
      ctx.store.dispatch(cmd);

      // Swift also rescales the playhead on fps change; it's outside the undo step there too.
      if (newFPS !== prevFPS) {
        const scale = newFPS / prevFPS;
        ctx.store.setPlayhead(Math.round(ctx.store.getSnapshot().playhead * scale));
      }

      const changes: string[] = [];
      if (newFPS !== prevFPS) changes.push(`fps ${prevFPS} → ${newFPS}`);
      if (newWidth !== prevWidth || newHeight !== prevHeight) {
        changes.push(`resolution ${prevWidth}×${prevHeight} → ${newWidth}×${newHeight}`);
      }
      if (changes.length === 0) {
        return ok(`No change — settings already match: ${newWidth}×${newHeight} @ ${newFPS}fps`);
      }
      return ok(`Updated: ${changes.join(", ")}. Now ${newWidth}×${newHeight} @ ${newFPS}fps.`);
    },
  };
}
