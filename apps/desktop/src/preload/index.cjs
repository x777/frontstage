"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopSpike", {
  encodeFrame: (rgba, w, h) => ipcRenderer.invoke("spike:encode-frame", rgba, w, h),
});

contextBridge.exposeInMainWorld("desktopExport", {
  start: (opts) => ipcRenderer.invoke("export:start", opts),
  videoFrame: (buf) => ipcRenderer.send("export:video-frame", buf),
  audioData: (buf) => ipcRenderer.send("export:audio-data", buf),
  finish: () => ipcRenderer.invoke("export:finish"),
});
