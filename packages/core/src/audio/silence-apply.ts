import type { Clip } from "../clip.js";
import { sourceFramesConsumed } from "../clip.js";
import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import type { FrameRange } from "../timeline/ripple-types.js";
import { mergeRanges } from "../timeline/ripple-engine.js";
import { rippleDeleteRangesOnTrack } from "../editor/ripple-commands.js";
import {
  DEFAULT_SILENCE_REMOVAL_SETTINGS,
  type SilenceRemovalSettings,
  removableMask,
  visibleRemovableRanges,
  VOICE_ACTIVITY_CHUNK_DURATION,
} from "./silence-planner.js";

export interface DeadAirMaskLookup {
  (mediaRef: string): boolean[] | undefined;
}

export class DeadAirSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadAirSelectionError";
  }
}

export function timelineRangeForSourceSpan(
  clip: Clip,
  sourceStart: number,
  sourceEnd: number,
): FrameRange | null {
  const s0 = Math.max(sourceStart, clip.trimStartFrame);
  const s1 = Math.min(sourceEnd, clip.trimStartFrame + sourceFramesConsumed(clip));
  if (!(s1 > s0) || !(clip.speed > 0)) return null;
  const t0 = clip.startFrame + (s0 - clip.trimStartFrame) / clip.speed;
  const t1 = clip.startFrame + (s1 - clip.trimStartFrame) / clip.speed;
  const range: FrameRange = { start: Math.round(t0), end: Math.round(t1) };
  return range.end - range.start > 0 ? range : null;
}

export function deadAirRangesForClip(
  clip: Clip,
  fps: number,
  settings: SilenceRemovalSettings,
  maskForMedia: DeadAirMaskLookup,
  cellDuration: number = VOICE_ACTIVITY_CHUNK_DURATION,
): FrameRange[] {
  const mask = maskForMedia(clip.mediaRef);
  if (!mask || mask.length === 0) return [];
  const visibleStart = clip.trimStartFrame;
  const visibleEnd = clip.trimStartFrame + sourceFramesConsumed(clip);
  return visibleRemovableRanges(
    mask,
    { start: visibleStart, end: visibleEnd },
    fps,
    settings,
    cellDuration,
  ).flatMap((r) => {
    const mapped = timelineRangeForSourceSpan(clip, r.start, r.end);
    return mapped ? [mapped] : [];
  });
}

export function allDeadAirByTrack(
  timeline: Timeline,
  settings: SilenceRemovalSettings,
  maskForMedia: DeadAirMaskLookup,
  cellDuration: number = VOICE_ACTIVITY_CHUNK_DURATION,
): { trackIndex: number; ranges: FrameRange[] }[] {
  const out: { trackIndex: number; ranges: FrameRange[] }[] = [];
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    const track = timeline.tracks[ti]!;
    if (track.type !== "audio") continue;
    const ranges = mergeRanges(
      track.clips.flatMap((c) => deadAirRangesForClip(c, timeline.fps, settings, maskForMedia, cellDuration)),
    );
    if (ranges.length > 0) out.push({ trackIndex: ti, ranges });
  }
  return out;
}

export type RemoveSilenceResult = {
  timeline: Timeline;
  sections: number;
  removedFrames: number;
  refusal?: string;
};

/** Palmier `removeAllDeadAir` — per-track ripple, one caller-owned undo. */
export function applyRemoveAllDeadAir(
  timeline: Timeline,
  settings: SilenceRemovalSettings = DEFAULT_SILENCE_REMOVAL_SETTINGS,
  maskForMedia: DeadAirMaskLookup,
  cellDuration: number = VOICE_ACTIVITY_CHUNK_DURATION,
): RemoveSilenceResult | null {
  let next = timeline;
  let sections = 0;
  let removedFrames = 0;
  let refusal: string | undefined;
  for (let n = 0; n < timeline.tracks.length; n++) {
    const batch = allDeadAirByTrack(next, settings, maskForMedia, cellDuration);
    const first = batch[0];
    if (!first) break;
    const outcome = rippleDeleteRangesOnTrack(next, first.trackIndex, first.ranges);
    if (outcome.kind === "ok") {
      next = outcome.timeline;
      sections += first.ranges.length;
      removedFrames += outcome.report.removedFrames;
    } else {
      refusal = outcome.reason;
      break;
    }
  }
  if (sections === 0 && refusal === undefined) return null;
  return { timeline: next, sections, removedFrames, refusal };
}

/** Palmier `removeDeadAir(clipIds:)` — scoped selection, linked A/V, one track of audio. */
export function applyRemoveDeadAirForClips(
  timeline: Timeline,
  clipIds: string[],
  settings: SilenceRemovalSettings,
  maskForMedia: DeadAirMaskLookup,
  cellDuration: number = VOICE_ACTIVITY_CHUNK_DURATION,
): RemoveSilenceResult | null {
  const targets: { trackIndex: number; clip: Clip }[] = [];
  for (const id of clipIds) {
    const loc = findClip(timeline, id);
    if (!loc) throw new DeadAirSelectionError("Selected clips could not be resolved.");
    targets.push({ trackIndex: loc.trackIndex, clip: timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]! });
  }
  if (targets.length === 0) throw new DeadAirSelectionError("Selected clips could not be resolved.");

  const audioTargets = targets.filter((t) => t.clip.mediaType === "audio");
  if (audioTargets.length === 0) {
    throw new DeadAirSelectionError("Selected clips must include at least one audio clip.");
  }

  const trackIndices = new Set(targets.map((t) => t.trackIndex));
  if (trackIndices.size > 1) {
    const linkGroups = targets.map((t) => t.clip.linkGroupId).filter((g): g is string => g !== undefined);
    if (linkGroups.length !== targets.length || new Set(linkGroups).size !== 1) {
      throw new DeadAirSelectionError("Selected clips must share one track or belong to one linked A/V unit.");
    }
  }
  const audioTrackIndices = new Set(audioTargets.map((t) => t.trackIndex));
  if (audioTrackIndices.size !== 1) {
    throw new DeadAirSelectionError("Selected audio clips must come from one track.");
  }
  const anchorTrackIndex = [...audioTrackIndices][0]!;

  const ranges = mergeRanges(
    audioTargets.flatMap((t) => deadAirRangesForClip(t.clip, timeline.fps, settings, maskForMedia, cellDuration)),
  );
  if (ranges.length === 0) return null;
  const outcome = rippleDeleteRangesOnTrack(timeline, anchorTrackIndex, ranges);
  if (outcome.kind === "ok") {
    return { timeline: outcome.timeline, sections: ranges.length, removedFrames: outcome.report.removedFrames };
  }
  return { timeline, sections: 0, removedFrames: 0, refusal: outcome.reason };
}

export function removableMaskForMedia(
  quietNonSpeech: boolean[] | undefined,
  settings: SilenceRemovalSettings,
  cellDuration: number = VOICE_ACTIVITY_CHUNK_DURATION,
): boolean[] | undefined {
  if (!quietNonSpeech) return undefined;
  return removableMask(quietNonSpeech, settings, cellDuration);
}
