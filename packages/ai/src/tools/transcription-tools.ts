import { z } from "zod";
import type { MediaManifestEntry, TimelineWord, TranscriptionResult } from "@palmier/core";
import { assembleTimelineWords, clipEndFrame, clipTimelineWords, transcriptTargets } from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { errorResult, ok } from "./executor.js";
import { keyMissingError } from "./generate-tools.js";

const TRANSCRIPT_WORD_LIMIT = 10_000;

/** Swift's captionCanTranscribe: audio, or video whose asset is known to carry an audio track. */
function canTranscribe(entry: MediaManifestEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.type === "audio") return true;
  return entry.type === "video" && entry.hasAudio !== false;
}

interface ClipRow {
  clipId: string;
  trackIndex: number;
  startFrame: number;
  endFrame: number;
  words: unknown[][];
}

export function getTranscriptTool(): ToolSpec {
  return {
    name: "get_transcript",
    description:
      "Returns the timeline's spoken-word transcript as project-frame words grouped by clip. " +
      "Paged at 10,000 words; continue with startFrame = nextStartFrame. Read-only — never mutates the timeline.",
    inputSchema: z.object({
      startFrame: z.number().int().optional(),
      endFrame: z.number().int().optional(),
      clipId: z.string().optional(),
      language: z.string().optional(),
    }),
    async run(args, ctx) {
      const a = args as { startFrame?: number; endFrame?: number; clipId?: string; language?: string };
      const facade = ctx.transcription;
      if (!facade) return errorResult("transcription is not available in this context");
      if (a.startFrame !== undefined && a.endFrame !== undefined && a.startFrame >= a.endFrame) {
        return errorResult(`startFrame (${a.startFrame}) must be less than endFrame (${a.endFrame})`);
      }

      const tl = ctx.store.getSnapshot().timeline;
      const fps = tl.fps;
      const entryById = new Map(ctx.getManifest().entries.map((e) => [e.id, e]));

      let targets = transcriptTargets(tl).filter((t) => canTranscribe(entryById.get(t.clip.mediaRef)));
      if (a.clipId !== undefined) {
        const restricted = targets.filter((t) => t.clip.id === a.clipId);
        if (restricted.length === 0) return errorResult(`unknown clip: ${a.clipId}`);
        targets = restricted;
      }

      // Cache-first per unique mediaRef; a language override always bypasses the cache (M11A rule),
      // so it's treated as uncached even when an auto-detected transcript already exists.
      const uniqueRefs = [...new Set(targets.map((t) => t.clip.mediaRef))];
      const resultByRef = new Map<string, TranscriptionResult>();
      const uncached: string[] = [];
      for (const ref of uniqueRefs) {
        if (a.language === undefined) {
          const cached = await facade.cachedTranscript(ref);
          if (cached) {
            resultByRef.set(ref, cached);
            continue;
          }
        }
        uncached.push(ref);
      }

      const skipped: { mediaRef: string; error: string }[] = [];
      if (uncached.length > 0) {
        if (!(await facade.hasKey().catch(() => false))) return keyMissingError("transcribe");
        const opts = a.language !== undefined ? { language: a.language } : undefined;
        const outcomes = await Promise.all(
          uncached.map(async (ref) => {
            try {
              return { ref, result: await facade.transcribe(ref, opts) };
            } catch (err) {
              skipped.push({ mediaRef: ref, error: err instanceof Error ? err.message : String(err) });
              return { ref, result: undefined };
            }
          }),
        );
        for (const { ref, result } of outcomes) if (result) resultByRef.set(ref, result);
      }

      const perClip: Omit<TimelineWord, "index">[][] = [];
      for (const { clip, trackIndex } of targets) {
        const transcript = resultByRef.get(clip.mediaRef);
        if (!transcript) continue;
        perClip.push(clipTimelineWords(clip, trackIndex, transcript, fps));
      }
      const words = assembleTimelineWords(perClip);

      const windowed = words.filter((w) => {
        if (a.startFrame !== undefined && w.endFrame <= a.startFrame) return false;
        if (a.endFrame !== undefined && w.startFrame >= a.endFrame) return false;
        return true;
      });

      const totalWords = windowed.length;
      const emitted = windowed.slice(0, TRANSCRIPT_WORD_LIMIT);
      const includesSpeakers = emitted.some((w) => w.speaker !== undefined);
      const wordFormat = includesSpeakers
        ? ["index", "text", "startFrame", "endFrame", "speaker"]
        : ["index", "text", "startFrame", "endFrame"];

      const targetByClipId = new Map(targets.map((t) => [t.clip.id, t]));
      const clipsOut: ClipRow[] = [];
      for (const w of emitted) {
        const last = clipsOut.at(-1);
        let group = last && last.clipId === w.clipId ? last : undefined;
        if (!group) {
          const target = targetByClipId.get(w.clipId);
          if (!target) continue;
          group = {
            clipId: w.clipId,
            trackIndex: target.trackIndex,
            startFrame: target.clip.startFrame,
            endFrame: clipEndFrame(target.clip),
            words: [],
          };
          clipsOut.push(group);
        }
        group.words.push(
          includesSpeakers
            ? [w.index, w.text, w.startFrame, w.endFrame, w.speaker ?? null]
            : [w.index, w.text, w.startFrame, w.endFrame],
        );
      }

      const out: Record<string, unknown> = {
        fps,
        timing: "projectFrames",
        wordFormat,
        clips: clipsOut,
        totalWords,
      };
      if (totalWords > TRANSCRIPT_WORD_LIMIT) out.nextStartFrame = windowed[TRANSCRIPT_WORD_LIMIT]!.startFrame;
      if (skipped.length > 0) out.skipped = skipped;

      return ok(JSON.stringify(out, null, 2));
    },
  };
}
