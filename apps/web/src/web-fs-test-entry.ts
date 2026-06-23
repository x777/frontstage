import { dirHandleProjectStore, WebMediaGateway } from "./web-fs.js";
(window as unknown as Record<string, unknown>).__webfs = { dirHandleProjectStore, WebMediaGateway };
