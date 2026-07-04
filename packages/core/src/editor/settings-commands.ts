import type { Clip } from "../clip.js";
import { clipEndFrame } from "../clip.js";
import { clampFadesToDuration, clampKeyframesToDuration, rescaleKeyframes } from "../clip-mutations.js";
import { fitTransform } from "../fit-transform.js";
import { trackIsActive } from "../keyframe.js";
import type { MediaManifest, MediaManifestEntry } from "../media.js";
import type { Timeline, Track } from "../timeline.js";
import type { Command } from "./editor-store.js";

// Ported from Swift EditorViewModel.applyTimelineSettings (#177): an fps change rescales every
// frame-based clip value (order preserved, rounding kept non-overlapping); a resolution change
// re-fits transforms that were still at their auto-fit letterbox/pillarbox size, or scales
// manual/keyframe-animated transforms proportionally instead.

const TRANSFORM_MATCH_TOLERANCE = 0.0001;

function rescaleTrackClips(clips: Clip[], scale: number): Clip[] {
  const order = clips.map((_, i) => i).sort((x, y) => clips[x]!.startFrame - clips[y]!.startFrame);
  const next = [...clips];
  let previousEnd: number | undefined;
  for (const i of order) {
    const clip = clips[i]!;
    const scaledStart = Math.round(clip.startFrame * scale);
    const scaledEnd = Math.round(clipEndFrame(clip) * scale);
    const startFrame = Math.max(scaledStart, previousEnd ?? scaledStart);
    const durationFrames = Math.max(1, scaledEnd - startFrame);
    let updated: Clip = {
      ...clip,
      startFrame,
      durationFrames,
      trimStartFrame: Math.round(clip.trimStartFrame * scale),
      trimEndFrame: Math.round(clip.trimEndFrame * scale),
      fadeInFrames: Math.round(clip.fadeInFrames * scale),
      fadeOutFrames: Math.round(clip.fadeOutFrames * scale),
    };
    updated = rescaleKeyframes(updated, scale);
    updated = clampKeyframesToDuration(updated);
    updated = clampFadesToDuration(updated);
    next[i] = updated;
    previousEnd = clipEndFrame(updated);
  }
  return next;
}

function mediaCanvasAspect(entry: MediaManifestEntry, canvasWidth: number, canvasHeight: number): number | undefined {
  const sw = entry.sourceWidth;
  const sh = entry.sourceHeight;
  if (!sw || !sh || sw <= 0 || sh <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return undefined;
  return sw / sh / (canvasWidth / canvasHeight);
}

function refitClipTransform(
  clip: Clip,
  manifest: MediaManifest,
  prevWidth: number,
  prevHeight: number,
  width: number,
  height: number,
): Clip {
  const entry = manifest.entries.find((e) => e.id === clip.mediaRef);
  if (!entry) return clip;
  const oldAspect = mediaCanvasAspect(entry, prevWidth, prevHeight);
  const newAspect = mediaCanvasAspect(entry, width, height);
  if (oldAspect === undefined || newAspect === undefined) return clip;

  const source = { width: entry.sourceWidth!, height: entry.sourceHeight! };
  const scaleAnimated = trackIsActive(clip.scaleTrack);
  const oldFit = fitTransform(source, { width: prevWidth, height: prevHeight });
  const matchesOldFit =
    Math.abs(clip.transform.width - oldFit.width) < TRANSFORM_MATCH_TOLERANCE &&
    Math.abs(clip.transform.height - oldFit.height) < TRANSFORM_MATCH_TOLERANCE;

  if (!scaleAnimated && matchesOldFit) {
    const newFit = fitTransform(source, { width, height });
    return { ...clip, transform: { ...clip.transform, width: newFit.width, height: newFit.height } };
  }

  const heightScale = oldAspect / newAspect;
  const scaleTrack =
    scaleAnimated && clip.scaleTrack
      ? { keyframes: clip.scaleTrack.keyframes.map((k) => ({ ...k, value: { ...k.value, b: k.value.b * heightScale } })) }
      : clip.scaleTrack;
  return { ...clip, transform: { ...clip.transform, height: clip.transform.height * heightScale }, scaleTrack };
}

/** set_project_settings' one undo step: fps applies ONLY when explicitly passed by the caller. */
export function applyTimelineSettingsCommand(
  fps: number,
  width: number,
  height: number,
  manifest: MediaManifest,
): Command {
  return {
    label: "Set Project Settings (Agent)",
    apply(timeline: Timeline): Timeline {
      const prevFPS = timeline.fps;
      const prevWidth = timeline.width;
      const prevHeight = timeline.height;

      let tracks: Track[] = timeline.tracks;

      if (fps !== prevFPS && prevFPS > 0 && fps > 0) {
        const scale = fps / prevFPS;
        tracks = tracks.map((track) => ({ ...track, clips: rescaleTrackClips(track.clips, scale) }));
      }

      if (width !== prevWidth || height !== prevHeight) {
        tracks = tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => refitClipTransform(clip, manifest, prevWidth, prevHeight, width, height)),
        }));
      }

      return { ...timeline, tracks, fps, width, height, settingsConfigured: true };
    },
  };
}
