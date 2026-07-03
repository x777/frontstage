/**
 * buildCatalog assembles all 34 currently available tools.
 *
 * DEFERRED tools (require host interfaces from later plans):
 *   - import_media        — plan 6.2 (media import pipeline)
 *   - inspect_timeline    — plan 6.3 (deep render analysis)
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
import { addCaptionsTool } from "./caption-tools.js";
import {
  listFoldersTool,
  createFolderTool,
  moveToFolderTool,
  renameMediaTool,
  renameFolderTool,
  deleteMediaTool,
  deleteFolderTool,
} from "./library-tools.js";

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
    addCaptionsTool(),
    // Media folder tools
    listFoldersTool(),
    createFolderTool(),
    moveToFolderTool(),
    renameMediaTool(),
    renameFolderTool(),
    deleteMediaTool(),
    deleteFolderTool(),
  ];
}
