import { dirHandleProjectStore, WebMediaGateway } from "./web-fs.js";
import { WebGateway } from "./web-gateway.js";
import { writeProject, readProject } from "@palmier/core";

// Always-attach: benign exposure of FS test utilities.
// The e2e runs against the dev server; in a production deploy this import
// can be dropped by removing the side-effect import in main.tsx.
(window as unknown as Record<string, unknown>).__webfs = { dirHandleProjectStore, WebMediaGateway };
(window as unknown as Record<string, unknown>).__webgateway = { WebGateway, writeProject, readProject };
