import { z } from "zod";
import {
  DEFAULT_SILENCE_REMOVAL_SETTINGS,
  DeadAirSelectionError,
  SILENCE_MINIMUM_PAUSE_RANGE,
  SILENCE_SPEECH_PADDING_RANGE,
  applyRemoveAllDeadAir,
  applyRemoveDeadAirForClips,
  parseSilenceRemovalSettings,
  quietNonSpeechFromWaveform,
  removableMask,
  type SilenceRemovalSettings,
} from "@frontstage/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

function parseSettings(
  minimumPauseSeconds: number | undefined,
  speechPaddingSeconds: number | undefined,
): SilenceRemovalSettings | { error: string } {
  const min =
    minimumPauseSeconds === undefined
      ? DEFAULT_SILENCE_REMOVAL_SETTINGS.minimumPauseSeconds
      : minimumPauseSeconds;
  const pad =
    speechPaddingSeconds === undefined
      ? DEFAULT_SILENCE_REMOVAL_SETTINGS.speechPaddingSeconds
      : speechPaddingSeconds;
  if (minimumPauseSeconds !== undefined) {
    if (
      !Number.isFinite(minimumPauseSeconds) ||
      minimumPauseSeconds < SILENCE_MINIMUM_PAUSE_RANGE.min ||
      minimumPauseSeconds > SILENCE_MINIMUM_PAUSE_RANGE.max
    ) {
      return {
        error: `remove_silence: minimumPauseSeconds must be a finite number from ${SILENCE_MINIMUM_PAUSE_RANGE.min} through ${SILENCE_MINIMUM_PAUSE_RANGE.max}.`,
      };
    }
  }
  if (speechPaddingSeconds !== undefined) {
    if (
      !Number.isFinite(speechPaddingSeconds) ||
      speechPaddingSeconds < SILENCE_SPEECH_PADDING_RANGE.min ||
      speechPaddingSeconds > SILENCE_SPEECH_PADDING_RANGE.max
    ) {
      return {
        error: `remove_silence: speechPaddingSeconds must be a finite number from ${SILENCE_SPEECH_PADDING_RANGE.min} through ${SILENCE_SPEECH_PADDING_RANGE.max}.`,
      };
    }
  }
  const settings = parseSilenceRemovalSettings(min, pad);
  if (!settings) return { error: "remove_silence: invalid silence-removal settings." };
  return settings;
}

export function removeSilenceTool(): ToolSpec {
  return {
    name: "remove_silence",
    description:
      "Remove dead air — quiet, speech-free sections — from the timeline's audio, ripple-closing the gaps. " +
      "Sections come from speech detection plus waveform level (music beds and loud ambience are not cut). " +
      "Cuts linked A/V partners and honors sync lock; the whole pass is one undoable action. " +
      "Omit clipIds to process the whole timeline. No transcript needed.",
    inputSchema: z.object({
      clipIds: z.array(z.string()).optional(),
      minimumPauseSeconds: z.number().finite().optional(),
      speechPaddingSeconds: z.number().finite().optional(),
    }),
    run(args, ctx) {
      const a = args as {
        clipIds?: string[];
        minimumPauseSeconds?: number;
        speechPaddingSeconds?: number;
      };
      const parsed = parseSettings(a.minimumPauseSeconds, a.speechPaddingSeconds);
      if ("error" in parsed) return errorResult(parsed.error);
      const settings = parsed;

      if (a.clipIds !== undefined) {
        if (a.clipIds.length === 0) return errorResult("remove_silence: clipIds must be a non-empty array of clip IDs.");
        for (let i = 0; i < a.clipIds.length; i++) {
          const id = a.clipIds[i]!;
          if (!id.trim()) return errorResult(`remove_silence: clipIds[${i}] must be a non-empty string.`);
          if (!ctx.store.getSnapshot().timeline.tracks.some((t) => t.clips.some((c) => c.id === id))) {
            return errorResult(`Clip not found: ${id}`);
          }
        }
      }

      const analysis = ctx.audioAnalysis;
      const maskForMedia = (mediaRef: string): boolean[] | undefined => {
        const quiet = analysis?.quietNonSpeechMask(mediaRef);
        if (quiet && quiet.length > 0) return removableMask(quiet, settings);
        const samples = analysis?.waveformSamples(mediaRef);
        if (!samples || samples.length === 0) return undefined;
        const speech = analysis?.speechMask?.(mediaRef);
        return removableMask(quietNonSpeechFromWaveform(samples, speech), settings);
      };

      try {
        const before = ctx.store.getSnapshot().timeline;
        const result = a.clipIds
          ? applyRemoveDeadAirForClips(before, a.clipIds, settings, maskForMedia)
          : applyRemoveAllDeadAir(before, settings, maskForMedia);
        if (!result) {
          const scope = a.clipIds === undefined ? "on the timeline" : "in the selected clips";
          return errorResult(
            `No dead air ${scope}. Speech analysis may still be running, or the audio has no quiet non-speech sections.`,
          );
        }
        if (result.refusal && result.sections === 0) {
          return errorResult(`Ripple delete refused: ${result.refusal}`);
        }
        ctx.store.dispatch({
          label: "Remove Silence",
          apply: () => result.timeline,
        });
        const extra: Record<string, unknown> = {
          sectionsRemoved: result.sections,
          removedFrames: result.removedFrames,
          minimumPauseSeconds: settings.minimumPauseSeconds,
          speechPaddingSeconds: settings.speechPaddingSeconds,
        };
        if (a.clipIds) extra.clipIds = a.clipIds;
        if (result.refusal) extra.note = `A later track refused: ${result.refusal}. Earlier tracks were already edited.`;
        return ok(JSON.stringify(extra));
      } catch (err) {
        if (err instanceof DeadAirSelectionError) return errorResult(`remove_silence: ${err.message}`);
        return errorResult(`remove_silence: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
