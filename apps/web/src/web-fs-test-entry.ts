import { dirHandleProjectStore, WebMediaGateway } from "./web-fs.js";
import { WebGateway } from "./web-gateway.js";
import { writeProject, readProject } from "@palmier/core";

(window as unknown as Record<string, unknown>).__webfs = { dirHandleProjectStore, WebMediaGateway };
(window as unknown as Record<string, unknown>).__webgateway = { WebGateway, writeProject, readProject };
