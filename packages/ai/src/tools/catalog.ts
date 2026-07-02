/**
 * buildCatalog assembles all 26 currently available tools.
 *
 * DEFERRED tools (require host interfaces from later plans):
 *   - import_media        — plan 6.2 (media import pipeline)
 *   - folder ops          — plan 6.2 (media folder CRUD)
 *   - inspect_timeline    — plan 6.3 (deep render analysis)
 *   - add_captions        — plan 6.6 (caption track + ASR)
 */

import type { ToolSpec } from "./types.js";
import { getTimelineTool, getMediaTool, inspectMediaTool, searchMediaTool } from "./read-tools.js";
import { addClipsTool, removeClipsTool, moveClipsTool, splitClipTool, splitClipsTool, trimClipsTool } from "./clip-tools.js";
import { setClipPropertiesTool, setKeyframesTool, addTextsTool } from "./property-tools.js";
import { removeTracksTool } from "./track-tools.js";
import { generateImageTool } from "./generate-image-tool.js";
import { generateVideoTool, generateAudioTool, upscaleMediaTool, listModelsTool } from "./generate-tools.js";
import { rippleDeleteRangesTool, insertClipsTool } from "./ripple-tools.js";
import { applyColorTool, applyEffectTool, inspectColorTool } from "./color-tools.js";
import { getTranscriptTool, removeWordsTool } from "./transcription-tools.js";

export function buildCatalog(): ToolSpec[] {
  return [
    // Read tools
    getTimelineTool(),
    getMediaTool(),
    inspectMediaTool(),
    searchMediaTool(),
    // Clip mutation tools
    addClipsTool(),
    removeClipsTool(),
    removeTracksTool(),
    moveClipsTool(),
    splitClipTool(),
    splitClipsTool(),
    trimClipsTool(),
    rippleDeleteRangesTool(),
    insertClipsTool(),
    // Property / keyframe / text tools
    setClipPropertiesTool(),
    setKeyframesTool(),
    addTextsTool(),
    // AI generation tools
    generateImageTool(),
    generateVideoTool(),
    generateAudioTool(),
    upscaleMediaTool(),
    listModelsTool(),
    // Color / effect tools
    applyColorTool(),
    applyEffectTool(),
    inspectColorTool(),
    // Transcript tools
    getTranscriptTool(),
    removeWordsTool(),
  ];
}
