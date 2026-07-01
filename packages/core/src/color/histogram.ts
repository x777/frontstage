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
