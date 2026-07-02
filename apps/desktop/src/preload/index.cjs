"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// E2E test hook: holds the latest onMenuCommand callback so tests can invoke it directly.
let _menuCommandCb = null;

contextBridge.exposeInMainWorld("desktopSpike", {
  encodeFrame: (rgba, w, h) => ipcRenderer.invoke("spike:encode-frame", rgba, w, h),
});

if (process.env.PALMIER_E2E === "1") {
  contextBridge.exposeInMainWorld("__e2eMenuTrigger", { fire: (cmd) => _menuCommandCb?.(cmd) });
}

contextBridge.exposeInMainWorld("desktopExport", {
  start: (opts) => ipcRenderer.invoke("export:start", opts),
  videoFrame: (buf) => ipcRenderer.send("export:video-frame", buf),
  audioData: (buf) => ipcRenderer.send("export:audio-data", buf),
  finish: () => ipcRenderer.invoke("export:finish"),
});

contextBridge.exposeInMainWorld("desktopAI", {
  setKey: (k, provider) => ipcRenderer.invoke("ai:setKey", k, provider),
  hasKey: (provider) => ipcRenderer.invoke("ai:hasKey", provider),
  clearKey: (provider) => ipcRenderer.invoke("ai:clearKey", provider),
  streamChat: (id, body) => ipcRenderer.send("ai:streamChat", { id, body }),
  onChunk: (cb) => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on("ai:chunk", h);
    return () => ipcRenderer.removeListener("ai:chunk", h);
  },
  generateImage: (body) => ipcRenderer.invoke("ai:generateImage", body),
});

contextBridge.exposeInMainWorld("desktopGen", {
  falSubmit: (modelEndpoint, input) => ipcRenderer.invoke("gen:falSubmit", { modelEndpoint, input }),
  falStatus: (modelEndpoint, jobId) => ipcRenderer.invoke("gen:falStatus", { modelEndpoint, jobId }),
  falDownload: (url) => ipcRenderer.invoke("gen:falDownload", { url }),
});

contextBridge.exposeInMainWorld("desktopMedia", {
  extractAudio: (opts) => ipcRenderer.invoke("media:extractAudio", opts),
});

contextBridge.exposeInMainWorld("desktopMcp", {
  setEnabled: (on) => ipcRenderer.invoke("mcp:setEnabled", on),
  getStatus: () => ipcRenderer.invoke("mcp:getStatus"),
  regenerateToken: () => ipcRenderer.invoke("mcp:regenerateToken"),
  onBridgeRequest: (cb) => {
    ipcRenderer.removeAllListeners("mcp:request");
    ipcRenderer.on("mcp:request", (_e, msg) => cb(msg));
  },
  bridgeRespond: (id, payload) => ipcRenderer.send("mcp:response", { id, ...payload }),
});

contextBridge.exposeInMainWorld("desktopProject", {
  pickOpen: () => ipcRenderer.invoke("project:pickOpen"),
  pickSaveAs: (n) => ipcRenderer.invoke("project:pickSaveAs", n),
  pickExportSave: (name) => ipcRenderer.invoke("project:pickExportSave", name),
  readText: (d, n) => ipcRenderer.invoke("project:readText", d, n),
  writeText: (d, n, x) => ipcRenderer.invoke("project:writeText", d, n, x),
  writeMedia: (d, r, b) => ipcRenderer.invoke("project:writeMedia", d, r, b),
  readMedia: (d, r) => ipcRenderer.invoke("project:readMedia", d, r),
  hasMedia: (d, r) => ipcRenderer.invoke("project:hasMedia", d, r),
  listRecent: () => ipcRenderer.invoke("project:listRecent"),
  addRecent: (rec) => ipcRenderer.invoke("project:addRecent", rec),
  removeRecent: (id) => ipcRenderer.invoke("project:removeRecent", id),
  __setNextPick: (p) => ipcRenderer.invoke("project:__setNextPick", p),
  ...(process.env.PALMIER_E2E === "1" ? { __setNextExportPick: (p) => ipcRenderer.invoke("project:__setNextExportPick", p) } : {}),
  onMenuCommand: (cb) => { ipcRenderer.removeAllListeners("menu:command"); ipcRenderer.on("menu:command", (_e, c, arg) => cb(c, arg)); _menuCommandCb = (c) => cb(c, undefined); },
  platform: process.platform,
});
