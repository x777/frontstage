import { affineTransform, mat2dApply, mat2dInvert, type Mat2d, type Size } from "./mat2d.js";
import { defaultCrop, type Crop, type Transform } from "./transform.js";
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
  /** Natural (pre-transform) pixel size the layer's Mat2d/crop were computed against — the hit
   * test needs this to convert an inverse-transformed point back into crop-fraction units. */
  natSize: Size;
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
        natSize,
      });
    }
  }
  return { layers, textLayers };
}

export interface PreviewPoint { x: number; y: number }

/**
 * Topmost visible clip (by track z-order — the M13A convention: track 0 draws last/on top,
 * matching the compositor's `tagged.sort((a,b) => b.zIndex - a.zIndex)` draw order in
 * source-coordinator.ts) whose rendered footprint contains `point`, in composition-pixel space
 * (0..renderSize.width, 0..renderSize.height). Text and video/image layers are ranked together by
 * their raw track zIndex — not "text always above video" — since that's what the renderer actually
 * draws. Crop trims the layer's own placed footprint (not a texture-only zoom), so a hit outside
 * the cropped region misses even though it's inside the full (uncropped) transform rect.
 */
export function topClipAtPoint(plan: RenderPlan, renderSize: Size, point: PreviewPoint): string | null {
  interface Candidate { clipId: string; zIndex: number; transform: Mat2d; natSize: Size; crop: Crop; opacity: number }
  const candidates: Candidate[] = [];

  for (const l of plan.layers) {
    if (l.opacity <= 0.01) continue;
    candidates.push({ clipId: l.clipId, zIndex: l.zIndex, transform: l.transform, natSize: l.natSize, crop: l.crop, opacity: l.opacity });
  }
  for (const t of plan.textLayers) {
    const { transform, opacity } = applyTextLayerAnim(t);
    if (opacity <= 0.01) continue;
    candidates.push({
      clipId: t.clipId, zIndex: t.zIndex, opacity,
      transform: affineTransform(transform, renderSize, renderSize),
      natSize: renderSize, crop: defaultCrop(),
    });
  }

  // Ascending zIndex: track 0 (topmost) first.
  candidates.sort((a, b) => a.zIndex - b.zIndex);

  for (const c of candidates) {
    const inv = mat2dInvert(c.transform);
    if (!inv) continue;
    const nat = mat2dApply(inv, point);
    const left = c.crop.left * c.natSize.width;
    const right = (1 - c.crop.right) * c.natSize.width;
    const top = c.crop.top * c.natSize.height;
    const bottom = (1 - c.crop.bottom) * c.natSize.height;
    if (nat.x >= left && nat.x <= right && nat.y >= top && nat.y <= bottom) return c.clipId;
  }
  return null;
}
