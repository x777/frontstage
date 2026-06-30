import type { Timeline } from "../timeline.js";
import type { TrackDropTarget } from "./geometry.js";
import type { FrameRange } from "./ripple-types.js";
import { computeRipplePush } from "./ripple-engine.js";
import type { DropPlan } from "./drop-routing.js";

export interface RippleInsertPreviewPlan {
  gapRangesByTrackIndex: Map<number, FrameRange>;
  newTrackGapRangesByTarget: Map<string, FrameRange>;
  shiftDeltasByClipId: Map<string, number>;
}

const targetKey = (t: TrackDropTarget): string => `${t.kind}:${t.index}`;

export function planRippleInsertPreview(timeline: Timeline, plan: DropPlan, atFrame: number): RippleInsertPreviewPlan | null {
  const gapLengthsByTrackIndex = new Map<number, number>();
  const newTrackGapLengthsByTarget = new Map<string, number>();
  const shiftDeltasByClipId = new Map<string, number>();

  // A visual new-track insertion before an existing audio target index pushes that index down by 1.
  const currentTrackIndex = (target: TrackDropTarget, visualTarget: TrackDropTarget | null): number | null => {
    if (target.kind !== "existing") return null;
    let index = target.index;
    if (visualTarget && visualTarget.kind === "new" && index > visualTarget.index) index -= 1;
    return index >= 0 && index < timeline.tracks.length ? index : null;
  };

  const affectedTrackIndexes = (target: TrackDropTarget, visualTarget: TrackDropTarget | null): Set<number> => {
    const indexes = new Set<number>();
    timeline.tracks.forEach((t, i) => { if (t.syncLocked) indexes.add(i); });
    const idx = currentTrackIndex(target, visualTarget);
    if (idx !== null) indexes.add(idx);
    return indexes;
  };

  const addPush = (target: TrackDropTarget | null, visualTarget: TrackDropTarget | null, pushAmount: number): void => {
    if (!target || pushAmount <= 0) return;
    if (target.kind === "new") {
      newTrackGapLengthsByTarget.set(targetKey(target), (newTrackGapLengthsByTarget.get(targetKey(target)) ?? 0) + pushAmount);
    }
    for (const trackIndex of affectedTrackIndexes(target, visualTarget)) {
      const clips = timeline.tracks[trackIndex]!.clips;
      const startById = new Map(clips.map((c) => [c.id, c.startFrame]));
      for (const shift of computeRipplePush(clips, atFrame, pushAmount)) {
        const orig = startById.get(shift.clipId);
        if (orig === undefined) continue;
        shiftDeltasByClipId.set(shift.clipId, (shiftDeltasByClipId.get(shift.clipId) ?? 0) + (shift.newStartFrame - orig));
      }
      gapLengthsByTrackIndex.set(trackIndex, (gapLengthsByTrackIndex.get(trackIndex) ?? 0) + pushAmount);
    }
  };

  addPush(plan.visualTarget, null, plan.visualDurationFrames);
  addPush(plan.audioTarget, plan.visualTarget, plan.audioOnlyDurationFrames);

  if (gapLengthsByTrackIndex.size === 0 && newTrackGapLengthsByTarget.size === 0 && shiftDeltasByClipId.size === 0) return null;

  const gapRangesByTrackIndex = new Map<number, FrameRange>();
  for (const [ti, len] of gapLengthsByTrackIndex) gapRangesByTrackIndex.set(ti, { start: atFrame, end: atFrame + len });
  const newTrackGapRangesByTarget = new Map<string, FrameRange>();
  for (const [key, len] of newTrackGapLengthsByTarget) newTrackGapRangesByTarget.set(key, { start: atFrame, end: atFrame + len });

  return { gapRangesByTrackIndex, newTrackGapRangesByTarget, shiftDeltasByClipId };
}
