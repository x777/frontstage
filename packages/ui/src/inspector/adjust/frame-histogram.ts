import { histogramYRGB } from "@palmier/core";

export async function computeFrameHistogram(
  engine: { readRGBA(): Promise<Uint8Array>; width: number; height: number },
): Promise<{ y: number[]; r: number[]; g: number[]; b: number[] }> {
  const rgba = await engine.readRGBA();
  return histogramYRGB(rgba, engine.width, engine.height);
}
