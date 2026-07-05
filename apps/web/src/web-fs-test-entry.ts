import { dirHandleProjectStore, WebMediaGateway } from "./web-fs.js";
import { WebGateway } from "./web-gateway.js";
import { writeProject, readProject } from "@frontstage/core";

// Attach FS test seams only in dev/test; stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__webfs = { dirHandleProjectStore, WebMediaGateway };
  (window as unknown as Record<string, unknown>).__webgateway = { WebGateway, writeProject, readProject };
}
