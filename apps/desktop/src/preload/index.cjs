"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// E2E test hook: holds the latest onMenuCommand callback so tests can invoke it directly.
let _menuCommandCb = null;

contextBridge.exposeInMainWorld("desktopSpike", {
  encodeFrame: (rgba, w, h) => ipcRenderer.invoke("spike:encode-frame", rgba, w, h),
});

if (process.env.PALMIER_E2E) {
  contextBridge.exposeInMainWorld("__e2eMenuTrigger", { fire: (cmd) => _menuCommandCb?.(cmd) });
}

contextBridge.exposeInMainWorld("desktopExport", {
  start: (opts) => ipcRenderer.invoke("export:start", opts),
  videoFrame: (buf) => ipcRenderer.send("export:video-frame", buf),
  audioData: (buf) => ipcRenderer.send("export:audio-data", buf),
  finish: () => ipcRenderer.invoke("export:finish"),
});

contextBridge.exposeInMainWorld("desktopProject", {
  pickOpen: () => ipcRenderer.invoke("project:pickOpen"),
  pickSaveAs: (n) => ipcRenderer.invoke("project:pickSaveAs", n),
  readText: (d, n) => ipcRenderer.invoke("project:readText", d, n),
  writeText: (d, n, x) => ipcRenderer.invoke("project:writeText", d, n, x),
  writeMedia: (d, r, b) => ipcRenderer.invoke("project:writeMedia", d, r, b),
  readMedia: (d, r) => ipcRenderer.invoke("project:readMedia", d, r),
  hasMedia: (d, r) => ipcRenderer.invoke("project:hasMedia", d, r),
  listRecent: () => ipcRenderer.invoke("project:listRecent"),
  addRecent: (rec) => ipcRenderer.invoke("project:addRecent", rec),
  removeRecent: (id) => ipcRenderer.invoke("project:removeRecent", id),
  __setNextPick: (p) => ipcRenderer.invoke("project:__setNextPick", p),
  onMenuCommand: (cb) => { ipcRenderer.removeAllListeners("menu:command"); ipcRenderer.on("menu:command", (_e, c) => cb(c)); _menuCommandCb = cb; },
});
