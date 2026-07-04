// Shared presets for editable project settings (agent set_project_settings; Swift's
// Inspector/ProjectSettingsPresets.swift is the source of truth — port verbatim).

export const ASPECT_RATIO_PRESETS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "2.4:1": { width: 2560, height: 1080 },
  "9:14": { width: 1080, height: 1680 },
};

export const QUALITY_PRESET_SHORT_EDGE: Record<string, number> = {
  "720p": 720,
  "1080p": 1080,
  "2K": 1440,
  "4K": 2160,
};

/** Scale resolution to a target short edge while preserving the current aspect ratio. */
export function qualityResolution(
  shortEdge: number,
  currentWidth: number,
  currentHeight: number,
): { width: number; height: number } {
  if (currentWidth <= currentHeight) {
    return { width: shortEdge, height: Math.round((shortEdge * currentHeight) / currentWidth) };
  }
  return { width: Math.round((shortEdge * currentWidth) / currentHeight), height: shortEdge };
}
