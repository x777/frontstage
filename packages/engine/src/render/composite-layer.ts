import type { Mat2d, Crop, Effect, BlendMode } from "@palmier/core";

export interface CompositeLayer {
  frame: VideoFrame;
  transform: Mat2d;
  opacity: number;
  crop: Crop;
  effects?: Effect[];
  blendMode?: BlendMode;
}
