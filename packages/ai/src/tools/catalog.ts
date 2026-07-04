/**
 * buildCatalog assembles the tool specs for one consumer. "inApp" (default) is the 40 tools the
 * in-app agent and web have always had, unchanged order. "mcp" appends get_projects/open_project/
 * new_project (43) — MCP-catalog-only, desktop-only (M13B T1, #238 ADAPTED).
 */

import type { ToolSpec } from "./types.js";
import { getTimelineTool, getMediaTool, inspectMediaTool, searchMediaTool } from "./read-tools.js";
import { inspectTimelineTool } from "./inspect-timeline-tool.js";
import { addClipsTool, removeClipsTool, moveClipsTool, splitClipTool, splitClipsTool, trimClipsTool } from "./clip-tools.js";
import { applyLayoutTool } from "./layout-tools.js";
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
  importMediaTool,
  createMatteTool,
} from "./library-tools.js";
import { exportProjectTool } from "./export-tools.js";
import { getProjectsTool, openProjectTool, newProjectTool } from "./project-tools.js";
import { setProjectSettingsTool } from "./settings-tools.js";

// mcp = inApp's 40 + the 3 project-nav tools (Swift's mcpServer/inAppAgent split, #238 ADAPTED —
// see project-tools.ts). The in-app agent and web never see the nav tools: buildCatalog() defaults
// to "inApp", so every pre-existing call site is unaffected.
export type CatalogKind = "inApp" | "mcp";

export function buildCatalog(kind: CatalogKind = "inApp"): ToolSpec[] {
  const specs = [
    // Read tools
    getTimelineTool(),
    getMediaTool(),
    inspectMediaTool(),
    inspectTimelineTool(),
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
    applyLayoutTool(),
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
    importMediaTool(),
    createMatteTool(),
    // Export tools
    exportProjectTool(),
    // Project settings
    setProjectSettingsTool(),
  ];
  if (kind === "mcp") specs.push(getProjectsTool(), openProjectTool(), newProjectTool());
  return specs;
}
