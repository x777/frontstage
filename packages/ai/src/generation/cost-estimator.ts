// Mirrors Swift's CostEstimator ceil-rounded credit math (1 credit == $0.01).
import type { GenModelEntry, GenToolParams } from "./gen-catalog.js";

function ceilCredits(credits: number): number {
  if (credits <= 0) return 0;
  return Math.ceil(credits);
}

function rateFor(dict: Record<string, number>, key: string | undefined): number {
  if (key !== undefined) {
    const v = dict[key];
    if (v !== undefined) return v;
  }
  return dict["default"] ?? 0;
}

function imageRateFor(dict: Record<string, number>, resolution: string | undefined, quality: string | undefined): number {
  if (resolution !== undefined && quality !== undefined) {
    const v = dict[`${resolution}|${quality}`];
    if (v !== undefined) return v;
  }
  return dict["default"] ?? 0;
}

export function estimateCredits(entry: GenModelEntry, params: GenToolParams): number {
  const pricing = entry.pricing;
  switch (pricing.kind) {
    case "perSecond": {
      const rate = rateFor(pricing.creditsPerSecond, params.resolution);
      return ceilCredits((params.duration ?? 0) * rate);
    }
    case "perImage": {
      const count = Math.max(1, params.numImages ?? 1);
      const rate = imageRateFor(pricing.creditsPerImage, params.resolution, params.quality);
      return ceilCredits(count * rate);
    }
    case "audioPerSecond":
      return ceilCredits((params.duration ?? 0) * pricing.creditsPerSecond);
    case "audioPerThousandChars": {
      const chars = (params.prompt?.length ?? 0) + (params.lyrics?.length ?? 0);
      return ceilCredits((chars / 1000) * pricing.creditsPer1k);
    }
    case "flat":
      return ceilCredits(pricing.credits);
    case "upscalePerSecond": {
      const duration = Math.max(1, params.duration ?? 0);
      return ceilCredits(duration * pricing.creditsPerSecond);
    }
  }
}

export function formatCredits(credits: number): string {
  const label = credits === 1 ? "1 credit" : `${credits} credits`;
  return `${label} (~$${(credits / 100).toFixed(2)})`;
}
