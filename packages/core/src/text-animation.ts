import { smoothstep } from "./keyframe.js";
import type { RGBA } from "./text-style.js";

// Swift: Models/TextAnimation.swift TextAnimation.Preset (CaseIterable order)
export const TEXT_ANIMATION_PRESETS = [
  "none", "fadeIn", "popIn", "slideUp", "typewriter",
  "wordReveal", "wordSlide", "wordPop", "wordCycle", "highlightPop", "highlightBlock",
] as const;
export type TextAnimationPreset = (typeof TEXT_ANIMATION_PRESETS)[number];

export interface TextWordTiming {
  text: string;
  startFrame: number;
  endFrame: number;
}

/** The discrete part — drives raster cache keys, never a per-frame continuous value. */
export interface TextWordState {
  visibleCount: number;
  highlightIndex: number | null;
  soloIndex: number | null;
}

/** The continuous part — applied at the layer level (opacity/transform), no re-raster. */
export interface TextLayerAnim {
  opacity: number;
  scale: number;
  /** Normalized fraction of render height, positive = down. Swift: TextAnimator.ClipState.dy */
  offsetY: number;
}

// Swift: TextAnimation.perWordFrames default = 6 (Models/TextAnimation.swift). The Swift model
// exposes this as a per-clip override; the ported Clip.textAnimation shape (see clip.ts) does not
// yet carry it, so T1 hardcodes the Swift default rather than partially porting the field — see
// task-1-report.md for the rationale.
const PER_WORD_FRAMES = 6;

// Swift: TextAnimation.defaultHighlight — used when Clip.textAnimation.highlightColor is unset.
export const DEFAULT_HIGHLIGHT_COLOR: RGBA = { r: 1, g: 0.85, b: 0, a: 1 };

/** Whitespace-run tokenization, matching Swift's `TextFrameRenderer.words(in:)` granularity — the
 * shared word-count/index basis for wordTimings alignment (render-plan) and raster layout (rasterizer). */
export function splitTextWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

const ENTRANCE_PRESETS: ReadonlySet<TextAnimationPreset> = new Set(["none", "fadeIn", "popIn", "slideUp"]);

/** Swift: TextAnimation.Preset.isPerWord / renderMode — true for perWord AND typewriter (both need wordTimings + a word-state raster); false only for the four whole-clip entrance presets. */
export function isWordPreset(preset: TextAnimationPreset): boolean {
  return !ENTRANCE_PRESETS.has(preset);
}

// Swift: TextAnimator.linear — raw (un-eased) 0..1 ramp across `dur` frames starting at `start`.
function linearRamp(rel: number, start: number, dur: number): number {
  if (rel <= start) return 0;
  if (rel >= start + dur) return 1;
  return (rel - start) / dur;
}

// Swift: TextAnimator.progress — eased 0..1 ramp.
function progress(rel: number, start: number, dur: number): number {
  return smoothstep(linearRamp(rel, start, dur));
}

/**
 * Swift: TextAnimator.overshoot — the back-ease wordPop uses on top of its visibleCount (constant
 * s = 1.70158, a spring/bounce past 1 before settling). Not consulted by textWordState (the
 * discrete reduction doesn't need the curve shape) — exported Swift-verbatim for T2's rasterizer,
 * which draws the per-word scale continuously and needs the exact easing, not just the boundary.
 */
export function wordPopOvershoot(t: number): number {
  const s = 1.70158;
  const p = t - 1;
  return 1 + (s + 1) * p * p * p + s * p * p;
}

/**
 * Swift: TextAnimator.activeRamp — 0 outside [word.startFrame, word.endFrame), ramped in/out over
 * `ramp` frames (shortened to at most half the word's own span so fast words still reach 1). Powers
 * wordCycle's fade and highlightPop/Block's pulse in Swift; exported for T2, not used by
 * textWordState (whose soloIndex/highlightIndex use plain window membership — see its docstring).
 */
export function wordActiveRamp(rel: number, word: TextWordTiming, ramp: number): number {
  if (rel < word.startFrame || rel >= word.endFrame) return 0;
  const span = Math.max(1, word.endFrame - word.startFrame);
  if (span <= 1) return 1;
  const r = Math.min(Math.max(1, ramp), Math.max(1, Math.floor(span / 2)));
  const rampIn = smoothstep(Math.min(1, (rel - word.startFrame) / r));
  const rampOut = smoothstep(Math.min(1, (word.endFrame - rel) / r));
  return Math.min(rampIn, rampOut);
}

/** The word (by index) whose [startFrame, endFrame) contains clipFrame, or null before the first / after the last / in a gap. Swift: activeRamp's own-span guard, evaluated per word in TextFrameRenderer.renderPerWord. */
function activeWordIndex(timings: TextWordTiming[], n: number, clipFrame: number): number | null {
  for (let i = 0; i < n; i++) {
    const t = timings[i]!;
    if (clipFrame >= t.startFrame && clipFrame < t.endFrame) return i;
  }
  return null;
}

/**
 * Swift: TextAnimator.clipEntry — the whole-clip entrance ramp (fadeIn/popIn/slideUp). `clipFrame`
 * is clip-relative (frame - clip.startFrame), matching Swift's `rel`. clipDurationFrames/fps are
 * unused here (Swift's clipEntry doesn't consult them either) — kept in the signature for callers
 * that need a uniform (preset, clipFrame, clipDurationFrames, fps) shape across layer-anim callers.
 */
export function textLayerAnim(
  preset: TextAnimationPreset,
  clipFrame: number,
  _clipDurationFrames: number,
  _fps: number,
): TextLayerAnim {
  const dur = Math.max(1, PER_WORD_FRAMES);
  const t = progress(clipFrame, 0, dur);
  switch (preset) {
    case "fadeIn":
      return { opacity: t, scale: 1, offsetY: 0 };
    case "popIn":
      return { opacity: t, scale: 0.6 + 0.4 * t, offsetY: 0 };
    case "slideUp":
      return { opacity: t, scale: 1, offsetY: 0.05 * (1 - t) };
    default:
      return { opacity: 1, scale: 1, offsetY: 0 };
  }
}

/**
 * Reduces a frame to the discrete word state that drives raster caching.
 *
 * Swift's per-word math (TextAnimator.wordState) is fully continuous — each word gets its own
 * opacity/scale/dy/color ramp evaluated every frame, with no caching. Porting that verbatim would
 * mean one raster per frame per word, defeating the state-cache architecture this model exists for.
 * Instead this reduces each preset to the frame at which its Swift ramp *starts* changing:
 *
 * - typewriter/wordReveal/wordSlide/wordPop are all "reveal and stay" in Swift (opacity ramps from
 *   word.startFrame and saturates at 1 forever after — it never fades back out). visibleCount counts
 *   a word from the exact frame Swift's own boundary check (`rel > start` for reveal/slide/pop,
 *   `rel >= end` for typewriter's word-complete count) would make it nonzero. The continuous
 *   in-between (opacity 0→1 over PER_WORD_FRAMES, wordSlide's dy, wordPop's overshoot scale) is
 *   NOT reproduced by this discrete value — a rasterizer wanting the smooth per-word motion must
 *   read clipFrame + wordTimings directly (T2 concern); this state only tells it which words are
 *   at least partially in play, at the same frame granularity Swift's own transition uses.
 * - wordCycle/highlightPop/highlightBlock use Swift's activeRamp, which is strictly windowed to
 *   [word.startFrame, word.endFrame) — at most one word's ramp is nonzero at a time (assuming
 *   non-overlapping timings). wordCycle only draws that word (soloIndex); the highlight presets
 *   draw every word (visibleCount = wordCount) and tint/scale only the active one (highlightIndex).
 */
export function textWordState(
  preset: TextAnimationPreset,
  wordTimings: TextWordTiming[] | undefined,
  clipFrame: number,
  wordCount: number,
): TextWordState {
  const allVisible: TextWordState = { visibleCount: wordCount, highlightIndex: null, soloIndex: null };
  if (!isWordPreset(preset)) return allVisible;
  if (!wordTimings || wordTimings.length === 0) return allVisible;
  const n = Math.min(wordCount, wordTimings.length);

  switch (preset) {
    case "typewriter": {
      let visibleCount = 0;
      for (let i = 0; i < n; i++) {
        if (clipFrame >= wordTimings[i]!.endFrame) visibleCount = i + 1;
        else break;
      }
      return { visibleCount, highlightIndex: null, soloIndex: null };
    }
    case "wordReveal":
    case "wordSlide":
    case "wordPop": {
      let visibleCount = 0;
      for (let i = 0; i < n; i++) {
        if (clipFrame > wordTimings[i]!.startFrame) visibleCount = i + 1;
        else break;
      }
      return { visibleCount, highlightIndex: null, soloIndex: null };
    }
    case "wordCycle":
      return { visibleCount: wordCount, highlightIndex: null, soloIndex: activeWordIndex(wordTimings, n, clipFrame) };
    case "highlightPop":
    case "highlightBlock":
      return { visibleCount: wordCount, highlightIndex: activeWordIndex(wordTimings, n, clipFrame), soloIndex: null };
    default:
      return allVisible;
  }
}
