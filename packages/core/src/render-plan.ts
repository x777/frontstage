import { affineTransform, type Mat2d, type Size } from "./mat2d.js";
import type { Crop } from "./transform.js";
import type { Timeline } from "./timeline.js";
import { clipTypeIsVisual } from "./clip-type.js";
import { clipContains, cropAt, opacityAt, transformAt } from "./clip.js";

export interface RenderLayer {
  clipId: string;
  mediaRef: string;
  transform: Mat2d;
  opacity: number;
  crop: Crop;
  zIndex: number;
}

export interface RenderPlan {
  layers: RenderLayer[];
}

export function buildRenderPlan(timeline: Timeline, frame: number, sourceSizes: Map<string, Size>): RenderPlan {
  const renderSize: Size = { width: timeline.width, height: timeline.height };
  const layers: RenderLayer[] = [];
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    const track = timeline.tracks[ti]!;
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.mediaType === "text") continue; // text rendering: later milestone
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
  return { layers };
}
