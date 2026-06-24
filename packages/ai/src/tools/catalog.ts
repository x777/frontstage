/**
 * buildCatalog assembles all 13 currently available tools.
 *
 * DEFERRED tools (require host interfaces from later plans):
 *   - import_media        — plan 6.2 (media import pipeline)
 *   - folder ops          — plan 6.2 (media folder CRUD)
 *   - inspect_timeline    — plan 6.3 (deep render analysis)
 *   - generate_image      — plan 6.5 (AI generation engine)
 *   - list_models         — plan 6.6 (model registry)
 *   - add_captions        — plan 6.6 (caption track + ASR)
 */

import type { ToolSpec } from "./types.js";
import { getTimelineTool, getMediaTool, inspectMediaTool, searchMediaTool } from "./read-tools.js";
import { addClipsTool, removeClipsTool, moveClipsTool, splitClipTool, trimClipsTool } from "./clip-tools.js";
import { setClipPropertiesTool, setKeyframesTool, addTextsTool } from "./property-tools.js";
import { removeTracksTool } from "./track-tools.js";

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
    trimClipsTool(),
    // Property / keyframe / text tools
    setClipPropertiesTool(),
    setKeyframesTool(),
    addTextsTool(),
  ];
}
