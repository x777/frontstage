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

/**
 * set_project_settings' one undo step: fps applies ONLY when explicitly passed by the caller.
 * `label` defaults to Swift's generic applyTimelineSettings action name ("Change Project
 * Settings"); set_project_settings itself overrides it to "Set Project Settings (Agent)",
 * matching Swift's setActionName call right after applyTimelineSettings.
 */
export function applyTimelineSettingsCommand(
  fps: number,
  width: number,
  height: number,
  manifest: MediaManifest,
  label = "Change Project Settings",
): Command {
  return {
    label,
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

export interface AgentResolutionAdoption {
  // Dispatch BEFORE the caller's own undo step — Swift applies this as its own separate undo
  // entry (applyTimelineSettings' default "Change Project Settings" action name) outside the
  // add_clips/insert_clips/apply_layout undo group.
  command: Command | null;
  // Prefix onto the tool's result text ahead of everything else (Swift: settingsNote + " " + rest).
  note: string | null;
}

/**
 * Ported from Swift's checkProjectSettings(adoptFPS: false) + applySettingsIfNeededForAgent
 * (EditorViewModel+ProjectSettings.swift / ToolExecutor+ProjectSettings.swift, post-#233 standing
 * rule): the agent's add_clips/insert_clips/apply_layout paths auto-match the timeline's
 * RESOLUTION to the first VIDEO asset among the ones being placed — fps is NEVER adopted here.
 * No even-rounding: Swift's checkProjectSettings uses the clip's sourceWidth/sourceHeight verbatim
 * (evenness is a render/export-canvas concern elsewhere — Matte.swift/TimelineRenderer.swift — not
 * part of this adoption path).
 *
 * `orderedAssets` must be in the exact order Swift scans for "the first video asset": add_clips /
 * insert_clips use the caller's entry order; apply_layout uses the layout's canonical slot order
 * (not the caller's slot order) — see ToolExecutor+Layout.swift's `layout.slots.compactMap`.
 */
export function planAgentResolutionAdoption(
  timeline: Timeline,
  manifest: MediaManifest,
  orderedAssets: MediaManifestEntry[],
): AgentResolutionAdoption {
  const firstVideo = orderedAssets.find((a) => a.type === "video");
  if (!firstVideo) return { command: null, note: null };

  const wasConfigured = timeline.settingsConfigured;
  const timelineIsEmpty = timeline.tracks.every((t) => t.clips.length === 0);

  let targetWidth = timeline.width;
  let targetHeight = timeline.height;
  let shouldApply = false;

  if (!wasConfigured) {
    // First clip ever — auto-detect settings silently, unconditionally (even a no-op resolution
    // still needs to flip settingsConfigured to true).
    targetWidth = firstVideo.sourceWidth ?? timeline.width;
    targetHeight = firstVideo.sourceHeight ?? timeline.height;
    shouldApply = true;
  } else if (timelineIsEmpty) {
    // Settings were configured before, but every clip is gone — treat like a fresh mismatch check.
    const clipWidth = firstVideo.sourceWidth;
    const clipHeight = firstVideo.sourceHeight;
    const resMismatch =
      (clipWidth !== undefined && clipWidth !== timeline.width) ||
      (clipHeight !== undefined && clipHeight !== timeline.height);
    if (resMismatch) {
      targetWidth = clipWidth ?? timeline.width;
      targetHeight = clipHeight ?? timeline.height;
      shouldApply = true;
    }
  }

  let command: Command | null = null;
  let note: string | null = null;
  if (shouldApply) {
    command = applyTimelineSettingsCommand(timeline.fps, targetWidth, targetHeight, manifest);
    if (targetWidth !== timeline.width || targetHeight !== timeline.height) {
      note = wasConfigured
        ? `Matched timeline resolution to clip: ${targetWidth}×${targetHeight}.`
        : `Set timeline to ${targetWidth}×${targetHeight} to match clip.`;
    }
  }

  const clipFPS = firstVideo.sourceFPS !== undefined ? Math.round(firstVideo.sourceFPS) : undefined;
  if (clipFPS !== undefined && clipFPS !== timeline.fps) {
    const fpsNote =
      `Clip is ${clipFPS}fps but project is ${timeline.fps}fps; clips placed at ${timeline.fps}fps and frame ` +
      `counts are interpreted at ${timeline.fps}fps. To conform, call set_project_settings then re-read get_timeline.`;
    note = note ? `${note} ${fpsNote}` : fpsNote;
  }

  return { command, note };
}
