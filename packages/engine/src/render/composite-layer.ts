import type { Mat2d, Crop, Effect, BlendMode, RGBA } from "@frontstage/core";

export interface CompositeLayer {
  frame: VideoFrame;
  transform: Mat2d;
  opacity: number;
  crop: Crop;
  effects?: Effect[];
  blendMode?: BlendMode;
  /** Palmier footage fill: glyph mask stencils layers below. */
  stencil?: boolean;
  /** Matte behind the stencil (text style color). */
  matteColor?: RGBA;
}
