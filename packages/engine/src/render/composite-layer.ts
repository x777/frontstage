import type { Mat2d, Crop, Effect, BlendMode } from "@frontstage/core";

export interface CompositeLayer {
  frame: VideoFrame;
  transform: Mat2d;
  opacity: number;
  crop: Crop;
  effects?: Effect[];
  blendMode?: BlendMode;
}
