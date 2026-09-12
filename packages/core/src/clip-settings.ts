import type { Clip } from "./clip.js";
import type { Effect, EffectParam } from "./color/effect.js";
import { findClip, type Timeline } from "./timeline.js";
import type { ClipType } from "./clip-type.js";

const GAUSSIAN_BLUR = "blur.gaussian";

export interface ClipSettingsTransferResult {
  changedClipIds: string[];
  unchangedClipIds: string[];
  mediaType: ClipType;
}

export type ClipSettingsTransferError =
  | { ok: false; message: string }
  | { ok: true; result: ClipSettingsTransferResult; timeline: Timeline };

function stripParamTracks(params: Record<string, EffectParam>): Record<string, EffectParam> {
  const out: Record<string, EffectParam> = {};
  for (const [key, param] of Object.entries(params)) {
    const next: EffectParam = {};
    if (param.value !== undefined) next.value = param.value;
    if (param.string !== undefined) next.string = param.string;
    out[key] = next;
  }
  return out;
}

function copyEffects(source: Clip, target: Clip): Effect[] | undefined {
  const skipGaussian = source.mediaType === "text";
  const copied: Effect[] = [];
  for (const effect of source.effects ?? []) {
    if (skipGaussian && effect.type === GAUSSIAN_BLUR) continue;
    copied.push({ ...effect, params: stripParamTracks(effect.params) });
  }
  if (skipGaussian) {
    for (const effect of target.effects ?? []) {
      if (effect.type === GAUSSIAN_BLUR) copied.push(effect);
    }
  }
  return copied.length > 0 ? copied : undefined;
}

/** Palmier `EditorViewModel.applyingStaticSettings` — placement/timing/keyframes/media stay on the target. */
export function applyingStaticSettings(source: Clip, target: Clip): Clip {
  let result: Clip = { ...target, effects: copyEffects(source, target) };

  switch (source.mediaType) {
    case "audio":
      result = { ...result, volume: source.volume };
      break;
    case "text":
      result = {
        ...result,
        opacity: source.opacity,
        textStyle: source.textStyle,
        textAnimation: source.textAnimation,
        textFillMode: source.textFillMode,
        transform: {
          ...result.transform,
          centerX: source.transform.centerX,
          centerY: source.transform.centerY,
          rotation: source.transform.rotation,
          flipHorizontal: source.transform.flipHorizontal,
          flipVertical: source.transform.flipVertical,
        },
      };
      break;
    case "video":
    case "image":
    case "lottie":
    case "sequence":
      result = {
        ...result,
        opacity: source.opacity,
        transform: { ...source.transform },
        crop: { ...source.crop },
        blendMode: source.blendMode,
      };
      break;
    case "subtitle":
      break;
  }
  return result;
}

function settingsFingerprint(clip: Clip): string {
  return JSON.stringify({
    volume: clip.volume,
    opacity: clip.opacity,
    transform: clip.transform,
    crop: clip.crop,
    blendMode: clip.blendMode ?? null,
    textStyle: clip.textStyle ?? null,
    textAnimation: clip.textAnimation ?? null,
    textFillMode: clip.textFillMode ?? null,
    effects: clip.effects ?? null,
  });
}

function clipById(timeline: Timeline, id: string): Clip | undefined {
  const loc = findClip(timeline, id);
  if (!loc) return undefined;
  return timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex];
}

/**
 * Palmier `applyClipSettings`. Dedupes targets, refuses mismatched media types, and returns a
 * new timeline with only the actually-changed clips rewritten.
 */
export function applyClipSettings(
  timeline: Timeline,
  sourceClipId: string,
  targetClipIds: string[],
): ClipSettingsTransferError {
  const seen = new Set<string>();
  const unique = targetClipIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (unique.length === 0) return { ok: false, message: "Provide at least one target clip." };

  const source = clipById(timeline, sourceClipId);
  if (!source) return { ok: false, message: `Clip not found: ${sourceClipId}` };

  const replacements = new Map<string, Clip>();
  for (const id of unique) {
    const target = clipById(timeline, id);
    if (!target) return { ok: false, message: `Clip not found: ${id}` };
    if (target.mediaType !== source.mediaType) {
      return {
        ok: false,
        message: `Clip ${id} is ${target.mediaType}; copied settings require ${source.mediaType} clips.`,
      };
    }
    replacements.set(id, id === sourceClipId ? target : applyingStaticSettings(source, target));
  }

  const changedClipIds = unique.filter((id) => {
    const current = clipById(timeline, id);
    const next = replacements.get(id);
    if (!current || !next) return false;
    return settingsFingerprint(current) !== settingsFingerprint(next);
  });
  const changed = new Set(changedClipIds);
  const unchangedClipIds = unique.filter((id) => !changed.has(id));

  if (changed.size === 0) {
    return {
      ok: true,
      result: { changedClipIds, unchangedClipIds, mediaType: source.mediaType },
      timeline,
    };
  }

  const nextTimeline: Timeline = {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!changed.has(clip.id)) return clip;
        return replacements.get(clip.id) ?? clip;
      }),
    })),
  };

  return {
    ok: true,
    result: { changedClipIds, unchangedClipIds, mediaType: source.mediaType },
    timeline: nextTimeline,
  };
}
