"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopSpike", {
  encodeFrame: (rgba, w, h) => ipcRenderer.invoke("spike:encode-frame", rgba, w, h),
});
