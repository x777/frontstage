import type { Clip } from "../clip.js";
import type { RGBA, TextStyle } from "../text-style.js";
import type { TextAnimationPreset } from "../text-animation.js";
import type { CaptionClipSpec } from "../captions/caption-mapper.js";
import type { Timeline } from "../timeline.js";
import type { Command } from "./editor-store.js";
import { insertTrackCommand } from "./track-commands.js";
import { replaceTrackClips } from "./timeline-commands.js";

export interface PlaceCaptionsArgs {
  specs: CaptionClipSpec[];
  style: TextStyle;
  animation?: { preset: TextAnimationPreset; highlightColor?: RGBA };
  /** Transform center, normalized [0,1]. Swift caption default: (0.5, 0.9) — near the bottom. */
  centerX?: number;
  centerY?: number;
  captionGroupId: string;
  newId(): string;
}

/**
 * Places a batch of built caption phrases as text clips on a freshly-inserted video track, in ONE
 * undo step. `insertTrackCommand(0, "video", ...)` is used for the insert: for a "video"-typed
 * insert, `partitionedInsertionIndex` clamps to `Math.min(bounded, firstAudioIndex)` where `bounded`
 * is already floored at 0 — so a requested index of 0 always resolves to exactly 0, unconditionally.
 * That's already "the top of the video zone" (video tracks occupy [0, firstAudioIndex) by
 * construction), so no extra zone-collision handling is needed here; the clamp does it for free.
 *
 * Determinism (M8.7 rule): every id `apply` will need — the new track's id, and each caption clip's
 * id/mediaRef — is generated ONCE via `args.newId()` here, at command-construction time, and closed
 * over by `apply`. `apply` itself never calls `args.newId()`, so calling it more than once against
 * the same starting timeline (e.g. a caller re-running the same command) reproduces byte-identical
 * output rather than minting fresh ids on each call.
 */
export function placeCaptionsCommand(args: PlaceCaptionsArgs): Command {
  const trackId = args.newId();
  const clipIds = args.specs.map(() => args.newId());
  const mediaRefs = args.specs.map(() => args.newId());
  const centerX = args.centerX ?? 0.5;
  const centerY = args.centerY ?? 0.9;

  return {
    label: "Add Captions",
    apply(timeline: Timeline): Timeline {
      const withTrack = insertTrackCommand(0, "video", () => trackId).apply(timeline);
      const trackIndex = 0;
      const track = withTrack.tracks[trackIndex]!;

      const clips: Clip[] = args.specs.map((spec, i) => ({
        id: clipIds[i]!,
        mediaRef: mediaRefs[i]!,
        mediaType: "text",
        sourceClipType: "text",
        startFrame: spec.startFrame,
        durationFrames: spec.durationFrames,
        trimStartFrame: 0,
        trimEndFrame: 0,
        speed: 1,
        volume: 1,
        fadeInFrames: 0,
        fadeOutFrames: 0,
        fadeInInterpolation: "linear",
        fadeOutInterpolation: "linear",
        opacity: 1,
        transform: { centerX, centerY, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        captionGroupId: args.captionGroupId,
        textContent: spec.content,
        textStyle: args.style,
        textAnimation: args.animation,
        wordTimings: spec.wordTimings,
      }));

      const sorted = [...track.clips, ...clips].sort((a, b) => a.startFrame - b.startFrame);
      return replaceTrackClips(withTrack, trackIndex, sorted);
    },
  };
}
