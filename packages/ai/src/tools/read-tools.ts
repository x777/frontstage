import { z } from "zod";
import type { ToolSpec } from "./types.js";
import { ok } from "./executor.js";

export function getTimelineTool(): ToolSpec {
  return {
    name: "get_timeline",
    description: "Returns a JSON summary of the current timeline: fps, dimensions, tracks, and clips.",
    inputSchema: z.object({}),
    run(_args, ctx) {
      const { timeline } = ctx.store.getSnapshot();
      const manifest = ctx.getManifest();
      const entryMap = new Map(manifest.entries.map((e) => [e.id, e]));

      const summary = {
        fps: timeline.fps,
        width: timeline.width,
        height: timeline.height,
        tracks: timeline.tracks.map((track) => ({
          id: track.id,
          type: track.type,
          clips: track.clips.map((clip) => ({
            id: clip.id,
            mediaType: clip.mediaType,
            startFrame: clip.startFrame,
            durationFrames: clip.durationFrames,
            name: entryMap.get(clip.mediaRef)?.name ?? clip.mediaRef,
          })),
        })),
      };

      return ok(JSON.stringify(summary, null, 2));
    },
  };
}

export function getMediaTool(): ToolSpec {
  return {
    name: "get_media",
    description: "Returns the media manifest entries available in the project.",
    inputSchema: z.object({}),
    run(_args, ctx) {
      const manifest = ctx.getManifest();
      const entries = manifest.entries.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        duration: e.duration,
        folderId: e.folderId ?? null,
      }));
      return ok(JSON.stringify(entries, null, 2));
    },
  };
}
