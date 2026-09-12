/**
 * buildCatalog assembles the tool specs for one consumer. "inApp" (default) is the editing tools
 * plus read_skill — in-app-only (M15 T1, Swift's ToolDefinitions.inAppAgent). "mcp" appends
 * get_projects/open_project/new_project instead — MCP-catalog-only, desktop-only (M13B T1, #238
 * ADAPTED); it never sees read_skill, mirroring Swift's mcpServer.
 */

import type { ToolSpec } from "./types.js";
import { getTimelineTool, getMediaTool, inspectMediaTool, searchMediaTool } from "./read-tools.js";
import { createTimelineTool, setActiveTimelineTool, manageMarkersTool } from "./timeline-tools.js";
import { inspectTimelineTool } from "./inspect-timeline-tool.js";
import { addClipsTool, removeClipsTool, moveClipsTool, splitClipTool, splitClipsTool, trimClipsTool } from "./clip-tools.js";
import { applyLayoutTool } from "./layout-tools.js";
import { setClipPropertiesTool, setKeyframesTool, addTextsTool } from "./property-tools.js";
import { copyClipSettingsTool } from "./clip-settings-tools.js";
import { swapClipMediaTool } from "./swap-clip-media-tool.js";
import { removeTracksTool, manageTracksTool } from "./track-tools.js";
import { generateImageTool } from "./generate-image-tool.js";
import { generateVideoTool, generateAudioTool, upscaleMediaTool, listModelsTool } from "./generate-tools.js";
import { rippleDeleteRangesTool, insertClipsTool } from "./ripple-tools.js";
import { applyColorTool, applyEffectTool, inspectColorTool } from "./color-tools.js";
import { getTranscriptTool, removeWordsTool } from "./transcription-tools.js";
import { addCaptionsTool } from "./caption-tools.js";
import { extractAudioTool } from "./extract-audio-tool.js";
import { removeSilenceTool } from "./silence-tools.js";
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
import { readSkillTool } from "./skill-tools.js";

// mcp = inApp catalog + the 3 project-nav tools (Swift's mcpServer/inAppAgent split, #238 ADAPTED —
// see project-tools.ts). The in-app agent and web never see the nav tools: buildCatalog() defaults
// to "inApp", so every pre-existing call site is unaffected.
export type CatalogKind = "inApp" | "mcp";

export function buildCatalog(kind: CatalogKind = "inApp"): ToolSpec[] {
  const specs = [
    // Read tools
    getTimelineTool(),
    createTimelineTool(),
    setActiveTimelineTool(),
    manageMarkersTool(),
    getMediaTool(),
    inspectMediaTool(),
    inspectTimelineTool(),
    searchMediaTool(),
    // Clip mutation tools
    addClipsTool(),
    removeClipsTool(),
    removeTracksTool(),
    manageTracksTool(),
    moveClipsTool(),
    splitClipTool(),
    splitClipsTool(),
    trimClipsTool(),
    swapClipMediaTool(),
    rippleDeleteRangesTool(),
    insertClipsTool(),
    applyLayoutTool(),
    // Property / keyframe / text tools
    setClipPropertiesTool(),
    copyClipSettingsTool(),
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
    removeSilenceTool(),
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
    extractAudioTool(),
    createMatteTool(),
    // Export tools
    exportProjectTool(),
    // Project settings
    setProjectSettingsTool(),
  ];
  if (kind === "mcp") specs.push(getProjectsTool(), openProjectTool(), newProjectTool());
  else specs.push(readSkillTool());
  return specs;
}
