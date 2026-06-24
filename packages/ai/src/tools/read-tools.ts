import { z } from "zod";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

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

export function inspectMediaTool(): ToolSpec {
  return {
    name: "inspect_media",
    description: "Returns full metadata for a single media entry by id.",
    inputSchema: z.object({ mediaId: z.string() }),
    run(args, ctx) {
      const { mediaId } = args as { mediaId: string };
      const entry = ctx.getManifest().entries.find((e) => e.id === mediaId);
      if (!entry) return errorResult(`unknown media: ${mediaId}`);

      const sourceInfo =
        entry.source.kind === "external"
          ? { kind: "external", absolutePath: entry.source.absolutePath }
          : { kind: "project", relativePath: entry.source.relativePath };

      return ok(
        JSON.stringify(
          {
            id: entry.id,
            name: entry.name,
            type: entry.type,
            source: sourceInfo,
            duration: entry.duration,
            sourceWidth: entry.sourceWidth ?? null,
            sourceHeight: entry.sourceHeight ?? null,
            sourceFPS: entry.sourceFPS ?? null,
            hasAudio: entry.hasAudio ?? null,
            folderId: entry.folderId ?? null,
          },
          null,
          2,
        ),
      );
    },
  };
}

export function searchMediaTool(): ToolSpec {
  return {
    name: "search_media",
    description: "Searches media manifest entries by name (case-insensitive substring match).",
    inputSchema: z.object({ query: z.string() }),
    run(args, ctx) {
      const { query } = args as { query: string };
      const lower = query.toLowerCase();
      const matches = ctx
        .getManifest()
        .entries.filter((e) => e.name.toLowerCase().includes(lower))
        .map((e) => ({ id: e.id, name: e.name, type: e.type }));

      if (matches.length === 0) return ok(`No media matches "${query}"`);
      return ok(JSON.stringify(matches, null, 2));
    },
  };
}
