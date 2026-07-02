import { affineTransform, type Mat2d, type Size } from "./mat2d.js";
import type { Crop, Transform } from "./transform.js";
import type { Timeline } from "./timeline.js";
import { clipTypeIsVisual } from "./clip-type.js";
import { clipContains, cropAt, opacityAt, transformAt } from "./clip.js";
import { type TextStyle, type RGBA, defaultTextStyle } from "./text-style.js";
import type { Effect } from "./color/effect.js";
import type { BlendMode } from "./color/blend-mode.js";
import {
  isWordPreset, splitTextWords, textLayerAnim, textWordState,
  type TextAnimationPreset, type TextLayerAnim, type TextWordState,
} from "./text-animation.js";

export interface RenderLayer {
  clipId: string;
  mediaRef: string;
  transform: Mat2d;
  opacity: number;
  crop: Crop;
  zIndex: number;
  effects?: Effect[];
  blendMode?: BlendMode;
}

export interface TextLayer {
  clipId: string;
  text: string;
  style: TextStyle;
  transform: Transform;
  opacity: number;
  zIndex: number;
  /** Set only while `textAnimation.preset` is active (not "none"/absent) — the rasterizer uses it
   * to disambiguate highlightPop/highlightBlock's per-word treatment (T1's TextWordState alone
   * doesn't carry that). */
  preset?: TextAnimationPreset;
  /** The discrete per-frame word state (T1's textWordState) — undefined for a non-word preset, or
   * when wordTimings is missing/misaligned to the text's word count (falls back to the static raster). */
  wordState?: TextWordState;
  /** The continuous whole-clip entrance ramp (T1's textLayerAnim) — applied at composite via
   * `applyTextLayerAnim`, never baked into the raster. */
  layerAnim?: TextLayerAnim;
  highlightColor?: RGBA;
}

export interface RenderPlan {
  layers: RenderLayer[];
  textLayers: TextLayer[];
}

/**
 * Applies a text layer's entrance ramp at composite time: opacity multiplies, scale/offsetY fold
 * onto the transform. Scale is centered on the transform's own center (width/height scale by
 * `anim.scale` while centerX/centerY stay fixed) — matching Swift's `applyEntrance`, which scales
 * the raster around `box.midX/midY`. `offsetY` is already a fraction of render height (T1's
 * TextLayerAnim doc), the same unit `Transform.centerY` uses, so it adds directly.
 */
export function applyTextLayerAnim(layer: TextLayer): { transform: Transform; opacity: number } {
  const anim = layer.layerAnim;
  if (!anim) return { transform: layer.transform, opacity: layer.opacity };
  const t = layer.transform;
  return {
    transform: { ...t, width: t.width * anim.scale, height: t.height * anim.scale, centerY: t.centerY + anim.offsetY },
    opacity: layer.opacity * anim.opacity,
  };
}

export function buildRenderPlan(timeline: Timeline, frame: number, sourceSizes: Map<string, Size>): RenderPlan {
  const renderSize: Size = { width: timeline.width, height: timeline.height };
  const layers: RenderLayer[] = [];
  const textLayers: TextLayer[] = [];
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    const track = timeline.tracks[ti]!;
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.mediaType === "text") {
        if (!clipContains(clip, frame)) continue;
        const text = clip.textContent ?? "";
        if (text.length === 0) continue;

        const preset = clip.textAnimation?.preset;
        const clipFrame = frame - clip.startFrame;
        let wordState: TextWordState | undefined;
        let layerAnim: TextLayerAnim | undefined;
        if (preset && preset !== "none") {
          layerAnim = textLayerAnim(preset, clipFrame, clip.durationFrames, timeline.fps);
          if (isWordPreset(preset)) {
            const words = splitTextWords(text);
            const timings = clip.wordTimings;
            // Length mismatch (wordTimings not aligned to the rendered word count) falls back to
            // the static raster rather than guessing an alignment — see task-2-report.md.
            if (timings && timings.length === words.length) {
              wordState = textWordState(preset, timings, clipFrame, words.length);
            }
          }
        }

        textLayers.push({
          clipId: clip.id,
          text,
          style: clip.textStyle ?? defaultTextStyle(),
          transform: transformAt(clip, frame),
          opacity: opacityAt(clip, frame),
          zIndex: ti,
          preset,
          wordState,
          layerAnim,
          highlightColor: clip.textAnimation?.highlightColor,
        });
        continue;
      }
      if (!clipTypeIsVisual(clip.mediaType)) continue; // skip audio
      if (!clipContains(clip, frame)) continue;
      const natSize = sourceSizes.get(clip.mediaRef) ?? renderSize;
      layers.push({
        clipId: clip.id,
        mediaRef: clip.mediaRef,
        transform: affineTransform(transformAt(clip, frame), natSize, renderSize),
        opacity: opacityAt(clip, frame),
        crop: cropAt(clip, frame),
        zIndex: ti,
        effects: clip.effects,
        blendMode: clip.blendMode,
      });
    }
  }
  return { layers, textLayers };
}
