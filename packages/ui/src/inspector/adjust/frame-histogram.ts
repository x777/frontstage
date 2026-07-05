import { histogramYRGB, hueHistogram } from "@frontstage/core";

type Engine = { readRGBA(): Promise<Uint8Array>; width: number; height: number };

export async function computeFrameHistogram(
  engine: Engine,
): Promise<{ y: number[]; r: number[]; g: number[]; b: number[] }> {
  const rgba = await engine.readRGBA();
  return histogramYRGB(rgba, engine.width, engine.height);
}

// Single readRGBA pass — returns both YRGB and hue histograms.
export async function computeFrameHistograms(
  engine: Engine,
): Promise<{ yrgb: { y: number[]; r: number[]; g: number[]; b: number[] }; hue: number[] }> {
  const rgba = await engine.readRGBA();
  return {
    yrgb: histogramYRGB(rgba, engine.width, engine.height),
    hue: hueHistogram(rgba, engine.width, engine.height),
  };
}
