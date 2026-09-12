import type { CaptionClipSpec } from "./caption-mapper.js";
import type { SubtitleCue } from "./subtitle-export.js";

interface TimedCaption {
  spec: CaptionClipSpec;
  originalDurationFrames: number;
}

/**
 * Specs for imported subtitle cues. Honors the file's timing: overlaps are resolved but gaps
 * are never closed. 1:1 with Palmier v0.9.0 `CaptionSpecBuilder.build(cues:…)` at
 * `maximumGapSeconds: 0`.
 */
export function captionSpecsFromCues(cues: SubtitleCue[], fps: number): CaptionClipSpec[] {
  const specs: CaptionClipSpec[] = [];
  for (const cue of cues) {
    const startFrame = Math.round(cue.startSec * fps);
    const endFrame = Math.round(cue.endSec * fps);
    specs.push({
      content: cue.text,
      startFrame,
      durationFrames: Math.max(1, endFrame - startFrame),
      wordTimings: [],
    });
  }
  return adjustedCaptionTiming(specs, 0);
}

function adjustedCaptionTiming(specs: CaptionClipSpec[], maximumGapFrames: number): CaptionClipSpec[] {
  const orderedIndices = specs.map((_, i) => i).sort((a, b) => {
    const lhsStart = specs[a]!.startFrame;
    const rhsStart = specs[b]!.startFrame;
    return lhsStart === rhsStart ? a - b : lhsStart - rhsStart;
  });
  const captions: TimedCaption[] = orderedIndices.map((i) => ({
    spec: specs[i]!,
    originalDurationFrames: specs[i]!.durationFrames,
  }));

  for (let nextIndex = 1; nextIndex < captions.length; nextIndex++) {
    const previousIndex = nextIndex - 1;
    const previous = captions[previousIndex]!;
    const next = captions[nextIndex]!;
    resolveOverlap(previous, next);

    if (maximumGapFrames > 0) {
      const previousEnd = endFrame(captions[previousIndex]!.spec);
      const gap = positiveDistance(previousEnd, captions[nextIndex]!.spec.startFrame);
      if (gap !== undefined && gap <= maximumGapFrames) {
        const duration = positiveDistance(
          captions[previousIndex]!.spec.startFrame,
          captions[nextIndex]!.spec.startFrame,
        );
        if (duration !== undefined) {
          captions[previousIndex]!.spec = resized(captions[previousIndex]!.spec, duration);
        }
      }
    }
  }
  return captions.map((c) => c.spec);
}

function resolveOverlap(previous: TimedCaption, next: TimedCaption): void {
  const previousEnd = endFrame(previous.spec);
  if (next.spec.startFrame >= previousEnd) return;

  if (next.spec.startFrame <= previous.spec.startFrame) {
    // Preserve transcript order when starts quantize to the same frame.
    previous.spec = resized(previous.spec, 1);
    next.spec = shiftStartPreservingEnd(next.spec, endFrame(previous.spec));
    return;
  }

  const overlap = positiveDistance(next.spec.startFrame, previousEnd);
  if (overlap === 1 && previous.originalDurationFrames < next.originalDurationFrames) {
    // The shorter caption owns a one-frame rounding collision.
    next.spec = shiftStartPreservingEnd(next.spec, previousEnd);
    return;
  }

  // Wider overlaps end at the next caption's authoritative start.
  const duration = positiveDistance(previous.spec.startFrame, next.spec.startFrame);
  if (duration !== undefined) previous.spec = resized(previous.spec, duration);
}

function endFrame(spec: CaptionClipSpec): number {
  return spec.startFrame + spec.durationFrames;
}

function positiveDistance(from: number, to: number): number | undefined {
  const d = to - from;
  return d > 0 ? d : undefined;
}

function shiftStartPreservingEnd(spec: CaptionClipSpec, startFrame: number): CaptionClipSpec {
  const originalEnd = endFrame(spec);
  const durationFrames = positiveDistance(startFrame, originalEnd) ?? 1;
  return resized({ ...spec, startFrame }, durationFrames);
}

function resized(spec: CaptionClipSpec, durationFrames: number): CaptionClipSpec {
  return { ...spec, durationFrames, wordTimings: [] };
}
