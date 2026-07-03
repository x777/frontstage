// Ported from Swift Models/Matte.swift's MatteAspect + Matte.even/Matte.fit — pure sizing math.

export type MatteAspect = "project" | "16:9" | "9:16" | "1:1" | "4:3" | "9:14" | "2.4:1";

export const MATTE_ASPECTS: readonly MatteAspect[] = ["project", "16:9", "9:16", "1:1", "4:3", "9:14", "2.4:1"];

// 2.4:1 is stored as 24/10 in Swift (not 2.4/1) so the integer aspect math matches exactly.
const ASPECT_RATIOS: Readonly<Record<Exclude<MatteAspect, "project">, readonly [number, number]>> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
  "1:1": [1, 1],
  "4:3": [4, 3],
  "9:14": [9, 14],
  "2.4:1": [24, 10],
};

function even(w: number, h: number): { width: number; height: number } {
  return {
    width: Math.max(2, Math.floor(Math.max(2, w) / 2) * 2),
    height: Math.max(2, Math.floor(Math.max(2, h) / 2) * 2),
  };
}

function fit(edge: number, aspectW: number, aspectH: number): { width: number; height: number } {
  const e = Math.max(2, edge);
  if (aspectW >= aspectH) return even(Math.round((e * aspectW) / aspectH), e);
  return even(e, Math.round((e * aspectH) / aspectW));
}

export function matteSize(aspect: MatteAspect, timelineWidth: number, timelineHeight: number): { width: number; height: number } {
  if (aspect === "project") return even(timelineWidth, timelineHeight);
  const [aw, ah] = ASPECT_RATIOS[aspect];
  return fit(Math.min(timelineWidth, timelineHeight), aw, ah);
}

export function matteName(aspect: MatteAspect, width: number, height: number): string {
  return aspect === "project" ? `Matte · ${width}×${height}` : `Matte · ${aspect}`;
}
