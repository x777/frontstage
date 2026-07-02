import { z } from "zod";
import {
  TEXT_ANIMATION_PRESETS,
  transcriptTargets,
  filterTranscript,
  buildCaptionPhrases,
  captionSpecsForClip,
  dominantSpeechTrack,
  placeCaptionsCommand,
  defaultTextStyle,
  rgbaFromHex,
  sourceFramesConsumed,
  type CaptionClipSpec,
  type CaptionPhrase,
  type TextStyle,
} from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";
import { keyMissingError, confirmationResult } from "./generate-tools.js";
import { canTranscribe, classifyRefsByCache, transcribeRefs } from "./transcription-tools.js";

const TEXT_CASES = ["auto", "upper", "lower"] as const;
type TextCase = (typeof TEXT_CASES)[number];

/**
 * Fallback text-measure used when the host hasn't wired `ctx.transcription.measureText` (M11D wires
 * a real Canvas2D-backed impl from @palmier/ui). Returns the rendered width of `text` at
 * `style.fontSize`, as a FRACTION of a 1920px-wide canvas — the same unit buildCaptionPhrases'
 * `measure` expects. Deliberately crude (no per-glyph metrics); documented deviation, not a bug.
 */
function heuristicMeasure(text: string, style: TextStyle): number {
  return (text.length * style.fontSize * 0.55) / 1920;
}

function applyTextCase(phrases: CaptionPhrase[], mode: TextCase): CaptionPhrase[] {
  if (mode === "auto") return phrases;
  const xform = mode === "upper" ? (s: string) => s.toUpperCase() : (s: string) => s.toLowerCase();
  return phrases.map((p) => ({ ...p, text: xform(p.text), words: p.words.map((w) => ({ ...w, text: xform(w.text) })) }));
}

export function addCaptionsTool(): ToolSpec {
  return {
    name: "add_captions",
    description:
      "Generates timed captions from the timeline's spoken-word transcript and places them as text clips " +
      "on a new video track. Targets explicit clipIds, or auto-detects the dominant speech track. One undo step.",
    inputSchema: z.object({
      clipIds: z.array(z.string()).optional(),
      centerX: z.number().finite().optional(),
      centerY: z.number().finite().optional(),
      textCase: z.enum(TEXT_CASES).optional(),
      language: z.string().optional(),
      animation: z.object({ preset: z.enum(TEXT_ANIMATION_PRESETS) }).optional(),
      highlightColor: z.string().optional(),
      maxWords: z.number().int().positive().optional(),
      fontSize: z.number().finite().min(12).max(300).optional(),
      fontName: z.string().optional(),
      color: z.string().optional(),
      confirm: z.boolean().optional(),
    }),
    async run(args, ctx) {
      const a = args as {
        clipIds?: string[];
        centerX?: number;
        centerY?: number;
        textCase?: TextCase;
        language?: string;
        animation?: { preset: (typeof TEXT_ANIMATION_PRESETS)[number] };
        highlightColor?: string;
        maxWords?: number;
        fontSize?: number;
        fontName?: string;
        color?: string;
        confirm?: boolean;
      };
      const facade = ctx.transcription;
      if (!facade) return errorResult("transcription is not available in this context");

      // Parse hex overrides up front — fail fast on bad input, before any transcription work.
      let color: TextStyle["color"] | undefined;
      if (a.color !== undefined) {
        const parsed = rgbaFromHex(a.color);
        if (!parsed) return errorResult(`invalid color: ${a.color}`);
        color = parsed;
      }
      let highlightColor: TextStyle["color"] | undefined;
      if (a.highlightColor !== undefined) {
        const parsed = rgbaFromHex(a.highlightColor);
        if (!parsed) return errorResult(`invalid highlightColor: ${a.highlightColor}`);
        highlightColor = parsed;
      }

      const tl = ctx.store.getSnapshot().timeline;
      const fps = tl.fps;
      const entryById = new Map(ctx.getManifest().entries.map((e) => [e.id, e]));

      // Explicit clipIds are filtered down to the transcribable pool (validated + hasAudio-filtered)
      // rather than erroring per unknown/incompatible id — mirrors the "→ none → error" brief text.
      let targets = transcriptTargets(tl).filter((t) => canTranscribe(entryById.get(t.clip.mediaRef)));
      if (a.clipIds !== undefined) {
        const idSet = new Set(a.clipIds);
        targets = targets.filter((t) => idSet.has(t.clip.id));
      }
      if (targets.length === 0) return errorResult("no transcribable clips");

      const uniqueRefs = [...new Set(targets.map((t) => t.clip.mediaRef))];
      const { resultByRef, uncachedRefs } = await classifyRefsByCache(facade, uniqueRefs, a.language);

      let skipped: { mediaRef: string; error: string }[] = [];
      if (uncachedRefs.length > 0) {
        if (!(await facade.hasKey().catch(() => false))) return keyMissingError("generate captions");

        // Cost gate (M10C pattern): only uncached refs cost anything — an all-cached request never
        // reaches here, so it never gates, matching get_transcript's "keyless + all-cached" rule.
        const threshold = ctx.generation?.confirmThreshold ?? 50;
        const estimate = uncachedRefs.reduce(
          (sum, ref) => sum + facade.estimateCredits(entryById.get(ref)?.duration ?? 0),
          0,
        );
        if (estimate > threshold && !a.confirm) return confirmationResult(estimate);

        const fetched = await transcribeRefs(facade, uncachedRefs, a.language);
        for (const [ref, result] of fetched.resultByRef) resultByRef.set(ref, result);
        skipped = fetched.skipped;
      }
      if (resultByRef.size === 0) {
        return errorResult(`all transcriptions failed: ${skipped.map((s) => `${s.mediaRef}: ${s.error}`).join("; ")}`);
      }

      // Auto-detect only when clipIds wasn't given; restrict to the dominant track only when
      // detection actually finds one (Swift: no restriction on a null/no-speech result).
      if (a.clipIds === undefined) {
        const dominant = dominantSpeechTrack(targets, resultByRef, fps);
        if (dominant !== null) targets = targets.filter((t) => t.trackIndex === dominant);
      }

      const style: TextStyle = {
        ...defaultTextStyle(),
        fontSize: a.fontSize ?? 48,
        ...(a.fontName !== undefined ? { fontName: a.fontName } : {}),
        ...(color !== undefined ? { color } : {}),
      };
      const measure = (text: string): number =>
        facade.measureText ? facade.measureText(text, style) : heuristicMeasure(text, style);
      const textCase: TextCase = a.textCase ?? "auto";

      const allSpecs: CaptionClipSpec[] = [];
      for (const target of targets) {
        const transcript = resultByRef.get(target.clip.mediaRef);
        if (!transcript) continue;

        // Window the transcript to the clip's visible SOURCE span (trim..trim+consumed), in seconds.
        const sourceStart = target.clip.trimStartFrame / fps;
        const sourceEnd = (target.clip.trimStartFrame + sourceFramesConsumed(target.clip)) / fps;
        const windowed = filterTranscript(transcript, sourceStart, sourceEnd);

        const phrases = applyTextCase(
          buildCaptionPhrases(windowed.segments, windowed.words, { measure, maxWords: a.maxWords }),
          textCase,
        );
        allSpecs.push(...captionSpecsForClip(target.clip, target.trackIndex, phrases, fps));
      }

      if (allSpecs.length === 0) {
        const note = skipped.length > 0 ? ` Skipped: ${skipped.map((s) => s.mediaRef).join(", ")}.` : "";
        return ok(`No captions were generated (no speech detected in the target clip(s)).${note}`);
      }

      const animation = a.animation
        ? { preset: a.animation.preset, ...(highlightColor !== undefined ? { highlightColor } : {}) }
        : undefined;
      const captionGroupId = ctx.newId();
      const cmd = placeCaptionsCommand({
        specs: allSpecs,
        style,
        animation,
        centerX: a.centerX,
        centerY: a.centerY,
        captionGroupId,
        newId: ctx.newId,
      });
      ctx.store.dispatch(cmd);

      const out: Record<string, unknown> = { captionsAdded: allSpecs.length, trackIndex: 0, captionGroupId };
      if (skipped.length > 0) out.skipped = skipped;
      return ok(JSON.stringify(out, null, 2));
    },
  };
}
