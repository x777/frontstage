import { sourceFramesConsumed, type Clip } from "./clip.js";
import type { MediaManifestEntry } from "./media.js";
import { findClip, type Timeline } from "./timeline.js";

export interface ClipMediaSwapPlan {
  clipId: string;
  oldMediaRef: string;
  newMediaRef: string;
  affectedClipIds: string[];
  trimEndFrames: Record<string, number>;
  changed: boolean;
}

export type ClipMediaSwapResult = { ok: true; plan: ClipMediaSwapPlan } | { ok: false; message: string };

function clipById(timeline: Timeline, id: string): Clip | undefined {
  const loc = findClip(timeline, id);
  if (!loc) return undefined;
  return timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex];
}

/** Palmier `linkedClipIdsSharingMedia` — link group members that still point at the same asset. */
export function linkedClipIdsSharingMedia(timeline: Timeline, anchorId: string): string[] {
  const clip = clipById(timeline, anchorId);
  if (!clip) return [anchorId];
  const ids = new Set<string>([anchorId]);
  if (clip.linkGroupId) {
    for (const track of timeline.tracks) {
      for (const c of track.clips) {
        if (c.linkGroupId === clip.linkGroupId && c.mediaRef === clip.mediaRef) ids.add(c.id);
      }
    }
  }
  return [...ids].sort();
}

function mediaSwapTargetClipIds(timeline: Timeline, clipId: string): ClipMediaSwapResult {
  const clip = clipById(timeline, clipId);
  if (!clip) return { ok: false, message: `Clip not found: ${clipId}` };
  if (clip.mediaType === "text" || clip.sourceClipType === "text" || clip.sourceClipType === "sequence") {
    return { ok: false, message: "This clip does not support media source swapping." };
  }
  return { ok: true, plan: {
    clipId,
    oldMediaRef: clip.mediaRef,
    newMediaRef: clip.mediaRef,
    affectedClipIds: linkedClipIdsSharingMedia(timeline, clipId),
    trimEndFrames: {},
    changed: false,
  } };
}

/**
 * Palmier `swapClipMedia` (commit:false) — validate + compute trim-end headroom. Does not mutate.
 */
export function planSwapClipMedia(
  timeline: Timeline,
  clipId: string,
  replacement: MediaManifestEntry,
): ClipMediaSwapResult {
  const anchor = clipById(timeline, clipId);
  if (!anchor) return { ok: false, message: `Clip not found: ${clipId}` };

  const targetsResult = mediaSwapTargetClipIds(timeline, clipId);
  if (!targetsResult.ok) return targetsResult;
  const ids = targetsResult.plan.affectedClipIds;
  const targets: Clip[] = [];
  for (const id of ids) {
    const clip = clipById(timeline, id);
    if (!clip) return { ok: false, message: "Linked clip not found." };
    targets.push(clip);
  }
  if (!targets.every((c) => c.sourceClipType === replacement.type)) {
    return { ok: false, message: "Replacement must match the clip's source type." };
  }

  const plan: ClipMediaSwapPlan = {
    clipId,
    oldMediaRef: anchor.mediaRef,
    newMediaRef: replacement.id,
    affectedClipIds: ids,
    trimEndFrames: {},
    changed: anchor.mediaRef !== replacement.id,
  };
  if (!plan.changed) return { ok: true, plan };

  if (replacement.type === "video" && replacement.hasAudio !== true && targets.some((c) => c.mediaType === "audio")) {
    return { ok: false, message: "Replacement video has no audio for the linked clip." };
  }

  if (replacement.type !== "image") {
    const available = Math.floor(replacement.duration * timeline.fps);
    if (!Number.isFinite(available) || available <= 0) {
      return { ok: false, message: "Replacement media has no valid duration." };
    }
    const trimEndFrames: Record<string, number> = {};
    for (const clip of targets) {
      const consumed = sourceFramesConsumed(clip);
      if (!Number.isFinite(consumed) || consumed < 0) {
        return { ok: false, message: "Clip has invalid source timing." };
      }
      const required = clip.trimStartFrame + consumed;
      if (!Number.isFinite(required) || required < 0 || required > available) {
        return { ok: false, message: "Replacement media is too short for the clip's source range." };
      }
      trimEndFrames[clip.id] = available - required;
    }
    plan.trimEndFrames = trimEndFrames;
  }

  return { ok: true, plan };
}

/** Palmier `replaceClipMediaRef` (no resetTrim). */
export function applySwapClipMedia(timeline: Timeline, plan: ClipMediaSwapPlan): Timeline {
  if (!plan.changed) return timeline;
  const ids = new Set(plan.affectedClipIds);
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!ids.has(clip.id)) return clip;
        const trimEnd = plan.trimEndFrames[clip.id];
        return {
          ...clip,
          mediaRef: plan.newMediaRef,
          ...(trimEnd !== undefined ? { trimEndFrame: trimEnd } : {}),
        };
      }),
    })),
  };
}
