export type BlendMode =
  | "normal" | "darken" | "multiply" | "colorBurn" | "lighten" | "screen" | "colorDodge"
  | "overlay" | "softLight" | "hardLight" | "difference" | "exclusion"
  | "hue" | "saturation" | "color" | "luminosity";

export const BLEND_MODES: readonly BlendMode[] = [
  "normal", "darken", "multiply", "colorBurn", "lighten", "screen", "colorDodge",
  "overlay", "softLight", "hardLight", "difference", "exclusion",
  "hue", "saturation", "color", "luminosity",
];
