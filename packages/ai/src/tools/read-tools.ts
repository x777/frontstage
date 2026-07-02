import { z } from "zod";
import type { Clip } from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

const KF_TRACKS = ["opacityTrack", "positionTrack", "scaleTrack", "rotationTrack", "cropTrack", "volumeTrack"] as const;
function keyframeSummary(clip: Clip): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const tk of KF_TRACKS) {
    const tr = clip[tk];
    if (tr && tr.keyframes.length > 0) out[tk] = tr.keyframes.map((k) => ({ frame: k.frame, value: k.value, interpolationOut: k.interpolationOut }));
  }
  return Object.keys(out).length ? out : undefined;
}

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
            opacity: clip.opacity,
            speed: clip.speed,
            volume: clip.volume,
            transform: clip.transform,
            crop: clip.crop,
            ...(clip.fadeInFrames ? { fadeInFrames: clip.fadeInFrames } : {}),
            ...(clip.fadeOutFrames ? { fadeOutFrames: clip.fadeOutFrames } : {}),
            ...(clip.textContent !== undefined ? { textContent: clip.textContent } : {}),
            ...(keyframeSummary(clip) ? { keyframes: keyframeSummary(clip) } : {}),
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

// NFD-decompose then strip combining marks, so accented and plain forms compare equal.
function normalizeSearchText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

interface SearchHit {
  id: string;
  name: string;
  type: string;
  spokenMatches?: { start: number; end: number; text: string }[];
}

export function searchMediaTool(): ToolSpec {
  return {
    name: "search_media",
    description:
      "Searches media manifest entries. scope='visual' matches by name (case-insensitive substring); " +
      "scope='spoken' matches cached transcript text (case/diacritic-insensitive, never transcribes); " +
      "scope='both' (default) unions the two.",
    inputSchema: z.object({
      query: z.string(),
      scope: z.enum(["visual", "spoken", "both"]).optional(),
    }),
    async run(args, ctx) {
      const { query, scope = "both" } = args as { query: string; scope?: "visual" | "spoken" | "both" };
      const entries = ctx.getManifest().entries;
      const hits = new Map<string, SearchHit>();

      if (scope !== "spoken") {
        const lower = query.toLowerCase();
        for (const e of entries) {
          if (e.name.toLowerCase().includes(lower)) hits.set(e.id, { id: e.id, name: e.name, type: e.type });
        }
      }

      if (scope !== "visual") {
        if (!ctx.transcription) {
          if (scope === "spoken") return errorResult("transcription is not available in this context");
        } else {
          const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
          for (const e of entries) {
            if (!e.transcriptPath) continue;
            const transcript = await ctx.transcription.cachedTranscript(e.id);
            if (!transcript) continue;
            const spokenMatches = transcript.segments
              .filter((s) => {
                const norm = normalizeSearchText(s.text);
                return terms.every((t) => norm.includes(t));
              })
              .map((s) => ({ start: s.start, end: s.end, text: s.text }));
            if (spokenMatches.length === 0) continue;
            const existing = hits.get(e.id);
            if (existing) existing.spokenMatches = spokenMatches;
            else hits.set(e.id, { id: e.id, name: e.name, type: e.type, spokenMatches });
          }
        }
      }

      const matches = [...hits.values()];
      if (matches.length === 0) return ok(`No media matches "${query}"`);
      return ok(JSON.stringify(matches, null, 2));
    },
  };
}
