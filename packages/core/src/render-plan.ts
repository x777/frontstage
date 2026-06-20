import { affineTransform, type Mat2d, type Size } from "./mat2d.js";
import type { Crop, Transform } from "./transform.js";
import type { Timeline } from "./timeline.js";
import { clipTypeIsVisual } from "./clip-type.js";
import { clipContains, cropAt, opacityAt, transformAt } from "./clip.js";
import { type TextStyle, defaultTextStyle } from "./text-style.js";

export interface RenderLayer {
  clipId: string;
  mediaRef: string;
  transform: Mat2d;
  opacity: number;
  crop: Crop;
  zIndex: number;
}

export interface TextLayer {
  clipId: string;
  text: string;
  style: TextStyle;
  transform: Transform;
  opacity: number;
  zIndex: number;
}

export interface RenderPlan {
  layers: RenderLayer[];
  textLayers: TextLayer[];
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
        textLayers.push({
          clipId: clip.id,
          text,
          style: clip.textStyle ?? defaultTextStyle(),
          transform: transformAt(clip, frame),
          opacity: opacityAt(clip, frame),
          zIndex: ti,
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
      });
    }
  }
  return { layers, textLayers };
}
