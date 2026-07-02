import { z } from "zod";
import type { Clip, FrameRange, MediaManifestEntry, TimelineWord, TranscriptionResult } from "@palmier/core";
import {
  assembleTimelineWords,
  clipEndFrame,
  clipTimelineWords,
  type CutAggressiveness,
  cutRanges,
  keptGapFrames,
  rippleDeleteRangesOnTrack,
  transcriptTargets,
} from "@palmier/core";
import type { ToolContext, ToolResult, ToolSpec } from "./types.js";
import { asUndoStep, errorResult, ok } from "./executor.js";
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

interface ResolvedWords {
  targets: { clip: Clip; trackIndex: number }[];
  words: TimelineWord[];
  skipped: { mediaRef: string; error: string }[];
}

type ResolveOutcome = ({ ok: true } & ResolvedWords) | { ok: false; result: ToolResult };

/**
 * Shared by get_transcript and remove_words: resolves this timeline's transcribable targets,
 * fetches (cache-first, unless a language override forces re-transcription) each unique
 * mediaRef's transcript, and maps them into one global, stably-indexed TimelineWord list.
 */
async function resolveTimelineWords(
  ctx: ToolContext,
  facade: NonNullable<ToolContext["transcription"]>,
  a: { clipId?: string; language?: string },
): Promise<ResolveOutcome> {
  const tl = ctx.store.getSnapshot().timeline;
  const fps = tl.fps;
  const entryById = new Map(ctx.getManifest().entries.map((e) => [e.id, e]));

  let targets = transcriptTargets(tl).filter((t) => canTranscribe(entryById.get(t.clip.mediaRef)));
  if (a.clipId !== undefined) {
    const restricted = targets.filter((t) => t.clip.id === a.clipId);
    if (restricted.length === 0) return { ok: false, result: errorResult(`unknown clip: ${a.clipId}`) };
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
    if (!(await facade.hasKey().catch(() => false))) return { ok: false, result: keyMissingError("transcribe") };
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

  return { ok: true, targets, words, skipped };
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

      const resolved = await resolveTimelineWords(ctx, facade, { clipId: a.clipId, language: a.language });
      if (!resolved.ok) return resolved.result;
      const { targets, words, skipped } = resolved;
      const fps = ctx.store.getSnapshot().timeline.fps;

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

// Swift normalizedWordMatch: trim whitespace/newlines + punctuation from both ends, then lowercase.
const NORMALIZE_STRIP = /^[\s\p{P}]+|[\s\p{P}]+$/gu;

function normalizedWordMatch(text: string): string {
  return text.replace(NORMALIZE_STRIP, "").toLowerCase();
}

export function removeWordsTool(): ToolSpec {
  return {
    name: "remove_words",
    description:
      "Word-precise ripple cut: removes the given transcript words (get_transcript index, an inclusive " +
      "[start, end] span, or exact-text matches) from the timeline and closes the gap. One undo step.",
    inputSchema: z.object({
      words: z.array(z.union([z.number().int(), z.tuple([z.number().int(), z.number().int()])])).optional(),
      matches: z.array(z.string()).optional(),
      cutAggressiveness: z.enum(["tight", "balanced", "loose"]).optional(),
      language: z.string().optional(),
    }),
    async run(args, ctx) {
      const a = args as {
        words?: (number | [number, number])[];
        matches?: string[];
        cutAggressiveness?: CutAggressiveness;
        language?: string;
      };
      const facade = ctx.transcription;
      if (!facade) return errorResult("transcription is not available in this context");
      if (a.words?.length === 0 || a.matches?.length === 0) {
        return errorResult("remove_words: words or matches must not be empty.");
      }
      if (a.words === undefined && a.matches === undefined) {
        return errorResult("remove_words: pass either words or matches.");
      }
      if (a.words !== undefined && a.matches !== undefined) {
        return errorResult("remove_words: pass either words or matches, not both.");
      }
      const aggressiveness: CutAggressiveness = a.cutAggressiveness ?? "balanced";

      const resolved = await resolveTimelineWords(ctx, facade, { language: a.language });
      if (!resolved.ok) return resolved.result;
      const { targets, words } = resolved;

      // Resolve the selection: indices/spans -> the words at those global indices (out-of-range
      // collected, not fatal); matches -> every word whose normalized text equals any match.
      const maxIndex = words.length - 1;
      const selected = new Set<number>();
      const indicesIgnored: number[] = [];
      if (a.words) {
        for (const w of a.words) {
          const pair: [number, number] = Array.isArray(w) ? w : [w, w];
          const lo = Math.min(pair[0], pair[1]);
          const hi = Math.max(pair[0], pair[1]);
          if (hi < 0 || lo > maxIndex) {
            indicesIgnored.push(lo);
            continue;
          }
          if (lo < 0) indicesIgnored.push(lo);
          if (hi > maxIndex) indicesIgnored.push(hi);
          for (let idx = Math.max(0, lo); idx <= Math.min(maxIndex, hi); idx++) selected.add(idx);
        }
      } else {
        const normalizedMatches = new Set((a.matches ?? []).map(normalizedWordMatch));
        for (const w of words) {
          if (normalizedMatches.has(normalizedWordMatch(w.text))) selected.add(w.index);
        }
      }
      if (selected.size === 0) return ok("No matching words found.");

      const targetByClipId = new Map(targets.map((t) => [t.clip.id, t]));
      const wordsByClip = new Map<string, TimelineWord[]>();
      for (const w of words) {
        const list = wordsByClip.get(w.clipId);
        if (list) list.push(w);
        else wordsByClip.set(w.clipId, [w]);
      }

      // cutRanges wants each clip's FULL word list (selected + kept) in index order, plus the
      // selected-index set, so neighbouring kept words correctly bound the pad — not just the
      // selected words in isolation (T1's real contract).
      const fps = ctx.store.getSnapshot().timeline.fps;
      const keepGapFrames = keptGapFrames(aggressiveness, fps);
      const removedTexts: string[] = [];
      const rangesByTrack = new Map<number, FrameRange[]>();
      const involvedClipIds: string[] = [];
      for (const [clipId, clipWords] of wordsByClip) {
        if (!clipWords.some((w) => selected.has(w.index))) continue;
        const target = targetByClipId.get(clipId);
        if (!target) continue;
        removedTexts.push(
          ...clipWords.filter((w) => selected.has(w.index) && w.endFrame > w.startFrame).map((w) => w.text),
        );
        const ranges = cutRanges(clipWords, selected, target.clip.startFrame, clipEndFrame(target.clip), keepGapFrames);
        if (ranges.length > 0) {
          const arr = rangesByTrack.get(target.trackIndex);
          if (arr) arr.push(...ranges);
          else rangesByTrack.set(target.trackIndex, [...ranges]);
          involvedClipIds.push(clipId);
        }
      }
      if (rangesByTrack.size === 0) return errorResult("The selected words resolved to no removable frames.");

      // Cut one track; rippleDeleteRangesOnTrack already carries the SAME ranges over to any
      // linked partner clip's track (shared linkGroupId) — using the other involved track's own
      // computed ranges here would double-cut it (Swift ToolExecutor+Words.swift: same rule).
      let primaryTrack: number;
      if (rangesByTrack.size === 1) {
        primaryTrack = [...rangesByTrack.keys()][0]!;
      } else {
        const groupIds = involvedClipIds.map((id) => targetByClipId.get(id)?.clip.linkGroupId);
        const shared = groupIds.every((g): g is string => g !== undefined) && new Set(groupIds).size === 1;
        if (!shared) {
          return errorResult("selected words span multiple tracks without a shared link group");
        }
        primaryTrack = Math.min(...rangesByTrack.keys());
      }
      const primaryRanges = rangesByTrack.get(primaryTrack)!;

      // Dry run on the live timeline to detect a refusal before dispatching anything (mirrors
      // ripple_delete_ranges' outcome check), then dispatch a re-runnable single undo step.
      const tl = ctx.store.getSnapshot().timeline;
      const dryRun = rippleDeleteRangesOnTrack(tl, primaryTrack, primaryRanges);
      if (dryRun.kind === "refused") return errorResult(`ripple delete refused: ${dryRun.reason}`);

      asUndoStep(ctx.store, "Remove Words", [
        (t) => {
          const o = rippleDeleteRangesOnTrack(t, primaryTrack, primaryRanges);
          return o.kind === "ok" ? o.timeline : t;
        },
      ]);

      const out: Record<string, unknown> = {
        removedWords: removedTexts.length,
        removedFrames: dryRun.report.removedFrames,
        tracksEdited: dryRun.report.clearedTracks,
        cutAggressiveness: aggressiveness,
      };
      if (indicesIgnored.length > 0) out.indicesIgnored = indicesIgnored.sort((x, y) => x - y);
      if (removedTexts.length > 0) {
        const joined = removedTexts.join(" ");
        out.removedText = joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
      }
      return ok(JSON.stringify(out, null, 2));
    },
  };
}
