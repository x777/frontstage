import type { Clip } from "../clip.js";
import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import { linkedPartnerIds } from "../timeline/link-group.js";
import { replaceClip } from "./timeline-commands.js";
import type { Command } from "./editor-store.js";

/** Image/text have no bounded source; Palmier also refuses multicam (not in this schema yet). */
export function isSlipEligible(clip: Clip): boolean {
  return clip.mediaType !== "image" && clip.mediaType !== "text";
}

/** Nested-sequence tail room lands later; until then this is trimEndFrame. */
export function effectiveTrimEnd(clip: Clip): number {
  return clip.trimEndFrame;
}

export function slipPropagationPartnerIds(timeline: Timeline, clipId: string): string[] {
  return linkedPartnerIds(timeline, clipId).filter((id) => {
    const loc = findClip(timeline, id);
    if (!loc) return false;
    return isSlipEligible(timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!);
  });
}

export function slipTargets(timeline: Timeline, clipId: string, propagateToLinked: boolean): Clip[] {
  const loc = findClip(timeline, clipId);
  if (!loc) return [];
  const lead = timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
  const targets = [lead];
  if (propagateToLinked) {
    for (const pid of slipPropagationPartnerIds(timeline, clipId)) {
      const pLoc = findClip(timeline, pid);
      if (pLoc) targets.push(timeline.tracks[pLoc.trackIndex]!.clips[pLoc.clipIndex]!);
    }
  }
  return targets.filter(isSlipEligible);
}

/** Tightest timeline-frame headroom across the group (right = reveal earlier / +delta). */
export function slipHeadroom(clips: readonly Clip[]): { right: number; left: number } {
  let right = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  for (const c of clips) {
    if (!isSlipEligible(c)) continue;
    const speed = Math.max(c.speed, 0.001);
    right = Math.min(right, Math.floor(c.trimStartFrame / speed));
    left = Math.min(left, Math.floor(effectiveTrimEnd(c) / speed));
  }
  return {
    right: Number.isFinite(right) ? right : 0,
    left: Number.isFinite(left) ? left : 0,
  };
}

export function clampSlipDelta(clips: readonly Clip[], deltaFrames: number): number {
  let delta = deltaFrames;
  for (const t of clips) {
    const speed = Math.max(t.speed, 0.001);
    delta = Math.min(delta, Math.floor(t.trimStartFrame / speed));
    delta = Math.max(delta, -Math.floor(effectiveTrimEnd(t) / speed));
  }
  return delta;
}

export function appliedSourceDelta(clip: Clip, delta: number): number {
  const sourceDelta = Math.round(delta * clip.speed);
  return Math.max(-effectiveTrimEnd(clip), Math.min(clip.trimStartFrame, sourceDelta));
}

export function slipClip(clip: Clip, delta: number): Clip {
  const applied = appliedSourceDelta(clip, delta);
  if (applied === 0) return clip;
  return { ...clip, trimStartFrame: clip.trimStartFrame - applied, trimEndFrame: clip.trimEndFrame + applied };
}

/** Shift the source in/out window; timeline start/duration stay fixed. */
export function slipClips(
  timeline: Timeline,
  clipId: string,
  deltaFrames: number,
  propagateToLinked: boolean,
): Timeline {
  const targets = slipTargets(timeline, clipId, propagateToLinked);
  if (targets.length === 0) return timeline;
  const delta = clampSlipDelta(targets, deltaFrames);
  if (delta === 0) return timeline;
  if (!targets.some((c) => appliedSourceDelta(c, delta) !== 0)) return timeline;
  const byId = new Map(targets.map((c) => [c.id, c]));
  let next = timeline;
  for (const [id, original] of byId) {
    next = replaceClip(next, id, () => slipClip(original, delta));
  }
  return next;
}

export function slipClipCommand(
  clipId: string,
  deltaFrames: number,
  propagateToLinked: boolean,
  coalesceKey?: string,
): Command {
  return {
    label: "Slip Clip",
    coalesceKey,
    apply(timeline) {
      return slipClips(timeline, clipId, deltaFrames, propagateToLinked);
    },
  };
}
