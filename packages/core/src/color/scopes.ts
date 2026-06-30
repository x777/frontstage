export interface Scopes {
  lumaMean: number; lumaBlack: number; lumaWhite: number; clipLow: number; clipHigh: number;
  lumaHistogram: number[];
  meanRGB: [number, number, number];
  blackRGB: [number, number, number]; whiteRGB: [number, number, number];
  shadowRGB: [number, number, number]; midRGB: [number, number, number]; highRGB: [number, number, number];
  saturationMean: number; warmCoolBias: number; greenMagentaBias: number;
  hueHistogram: number[]; colorfulPct: number;
}

const REC = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

export function computeScopes(rgba: Uint8Array, width: number, height: number): Scopes {
  const fc = width * height;
  if (fc === 0) return { lumaMean: 0, lumaBlack: 0, lumaWhite: 0, clipLow: 0, clipHigh: 0, lumaHistogram: new Array(16).fill(0), meanRGB: [0,0,0], blackRGB: [0,0,0], whiteRGB: [0,0,0], shadowRGB: [0,0,0], midRGB: [0,0,0], highRGB: [0,0,0], saturationMean: 0, warmCoolBias: 0, greenMagentaBias: 0, hueHistogram: new Array(12).fill(0), colorfulPct: 0 };
  const lumaHistogram = new Array(16).fill(0);
  const hueHistogram = new Array(12).fill(0);
  const lumas: number[] = []; const rs: number[] = []; const gs: number[] = []; const bs: number[] = [];
  let sumR = 0, sumG = 0, sumB = 0, sumSat = 0, sumLuma = 0, clipLow = 0, clipHigh = 0, hueWeight = 0, colorful = 0;
  const zone = { shadow: [0, 0, 0, 0], mid: [0, 0, 0, 0], high: [0, 0, 0, 0] };
  for (let i = 0; i < fc; i++) {
    const r = rgba[i * 4]! / 255, g = rgba[i * 4 + 1]! / 255, b = rgba[i * 4 + 2]! / 255;
    const y = REC(r, g, b);
    sumLuma += y;
    lumas.push(y); rs.push(r); gs.push(g); bs.push(b);
    sumR += r; sumG += g; sumB += b;
    if (y < 0.02) clipLow++; if (y > 0.98) clipHigh++;
    lumaHistogram[Math.min(15, Math.floor(y * 16))]++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max <= 0 ? 0 : (max - min) / max;
    sumSat += sat;
    if (sat > 0.15) {
      let h = 0; const d = max - min;
      if (d > 1e-9) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
      hueHistogram[Math.min(11, Math.floor(h * 12))] += sat; hueWeight += sat; colorful++;
    }
    const z = y < 1 / 3 ? zone.shadow : y < 2 / 3 ? zone.mid : zone.high;
    z[0]! += r; z[1]! += g; z[2]! += b; z[3]!++;
  }
  lumas.sort((a, b) => a - b); rs.sort((a, b) => a - b); gs.sort((a, b) => a - b); bs.sort((a, b) => a - b);
  const zoneRGB = (z: number[]): [number, number, number] => z[3]! > 0 ? [z[0]! / z[3]!, z[1]! / z[3]!, z[2]! / z[3]!] : [0, 0, 0];
  const meanR = sumR / fc, meanG = sumG / fc, meanB = sumB / fc;
  return {
    lumaMean: sumLuma / fc,
    lumaBlack: percentile(lumas, 0.02), lumaWhite: percentile(lumas, 0.98),
    clipLow: clipLow / fc, clipHigh: clipHigh / fc,
    lumaHistogram: lumaHistogram.map((v) => v / fc),
    meanRGB: [meanR, meanG, meanB],
    blackRGB: [percentile(rs, 0.02), percentile(gs, 0.02), percentile(bs, 0.02)],
    whiteRGB: [percentile(rs, 0.98), percentile(gs, 0.98), percentile(bs, 0.98)],
    shadowRGB: zoneRGB(zone.shadow), midRGB: zoneRGB(zone.mid), highRGB: zoneRGB(zone.high),
    saturationMean: sumSat / fc, warmCoolBias: meanR - meanB, greenMagentaBias: meanG - (meanR + meanB) / 2,
    hueHistogram: hueHistogram.map((v) => (hueWeight > 0 ? v / hueWeight : 0)), colorfulPct: colorful / fc,
  };
}
