import { rgbToHsv } from "./color-math.js";

export function hueHistogram(rgba: Uint8Array, width: number, height: number, bins = 96): number[] {
  const out = new Array<number>(bins).fill(0);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const { h, s } = rgbToHsv({ r: rgba[i * 4]! / 255, g: rgba[i * 4 + 1]! / 255, b: rgba[i * 4 + 2]! / 255 });
    const hueN = ((h % 1) + 1) % 1;
    const bin = Math.min(bins - 1, Math.floor(hueN * bins));
    out[bin] = (out[bin] ?? 0) + s;
  }
  return out;
}

export function histogramYRGB(rgba: Uint8Array, width: number, height: number, bins = 256): { y: number[]; r: number[]; g: number[]; b: number[] } {
  const y = new Array<number>(bins).fill(0), r = new Array<number>(bins).fill(0), g = new Array<number>(bins).fill(0), b = new Array<number>(bins).fill(0);
  const n = width * height;
  const bin = (v: number) => Math.min(bins - 1, Math.floor((v / 256) * bins));
  const inc = (arr: number[], i: number) => { arr[i] = (arr[i] ?? 0) + 1; };
  for (let i = 0; i < n; i++) {
    const R = rgba[i * 4]!, G = rgba[i * 4 + 1]!, B = rgba[i * 4 + 2]!;
    const Y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
    inc(y, bin(Y)); inc(r, bin(R)); inc(g, bin(G)); inc(b, bin(B));
  }
  return { y, r, g, b };
}
