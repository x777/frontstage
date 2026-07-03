"use strict";

const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, session } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const dns = require("node:dns");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { Agent } = require("undici");

// ── MCP server state ─────────────────────────────────────────────────────────

const MCP_PORT = Number(process.env.MCP_PORT) || 19789;

// ── MCP bridge (main↔renderer) ───────────────────────────────────────────────

const _bridgePending = new Map();
let _bridgeSeq = 0;

ipcMain.on("mcp:response", (_e, { id, result, error }) => {
  const p = _bridgePending.get(id);
  if (!p) return;
  _bridgePending.delete(id);
  clearTimeout(p.timer);
  if (error != null) p.reject(new Error(error));
  else p.resolve(result);
});

function mcpBridge(kind, payload) {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.isDestroyed());
  if (!win) return Promise.reject(new Error("editor not ready"));
  const id = ++_bridgeSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (_bridgePending.delete(id)) reject(new Error("bridge timeout"));
    }, 30000);
    _bridgePending.set(id, { resolve, reject, timer });
    win.webContents.send("mcp:request", { id, kind, payload });
  });
}

let _mcpServer = null;
let _mcpToken = null; // set after app.getPath("userData") is available

function mcpTokenFile() {
  return path.join(app.getPath("userData"), "mcp-token");
}

function mcpEnabledFile() {
  return path.join(app.getPath("userData"), "mcp-enabled");
}

function loadOrCreateToken() {
  try {
    const existing = fs.readFileSync(mcpTokenFile(), "utf8").trim();
    if (existing) return existing;
  } catch { /* not found */ }
  const token = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(mcpTokenFile()), { recursive: true });
    fs.writeFileSync(mcpTokenFile(), token, { mode: 0o600 });
  } catch (e) { console.warn("[mcp] failed to persist token:", e.message); }
  return token;
}

function writeToken(token) {
  try {
    fs.mkdirSync(path.dirname(mcpTokenFile()), { recursive: true });
    fs.writeFileSync(mcpTokenFile(), token, { mode: 0o600 });
  } catch (e) { console.warn("[mcp] failed to persist token:", e.message); }
}

function writeEnabled(on) {
  try {
    fs.mkdirSync(path.dirname(mcpEnabledFile()), { recursive: true });
    fs.writeFileSync(mcpEnabledFile(), on ? "1" : "0", "utf8");
  } catch { /* best-effort */ }
}

function readEnabled() {
  try {
    return fs.readFileSync(mcpEnabledFile(), "utf8").trim() === "1";
  } catch {
    return false;
  }
}

ipcMain.handle("mcp:getStatus", () => ({
  enabled: _mcpServer != null,
  running: _mcpServer != null,
  url: `http://127.0.0.1:${MCP_PORT}/mcp`,
  token: _mcpToken,
}));

ipcMain.handle("mcp:setEnabled", async (_e, on) => {
  if (on && !_mcpServer) {
    const mod = await import("./mcp/server.mjs");
    _mcpServer = await mod.startMcpServer({ port: MCP_PORT, token: _mcpToken, bridge: mcpBridge });
    writeEnabled(true);
  } else if (!on && _mcpServer) {
    await _mcpServer.close();
    _mcpServer = null;
    writeEnabled(false);
  }
  return { enabled: _mcpServer != null };
});

ipcMain.handle("mcp:regenerateToken", async () => {
  _mcpToken = crypto.randomBytes(32).toString("hex");
  writeToken(_mcpToken);
  if (_mcpServer) {
    await _mcpServer.close();
    const mod = await import("./mcp/server.mjs");
    _mcpServer = await mod.startMcpServer({ port: MCP_PORT, token: _mcpToken, bridge: mcpBridge });
  }
  return _mcpToken;
});

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
// Forcing Vulkan/Skia destabilises the WebGPU device on Windows GPUs (device-lost → blank preview); Dawn uses D3D12/Metal there. Only Linux needs the Vulkan hint.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");

// ── Project IPC (Task 2) ────────────────────────────────────────────────────

const authorizedDirs = new Set();

function authorize(p) {
  authorizedDirs.add(path.resolve(p));
}

function assertAuthorized(dir) {
  if (!authorizedDirs.has(path.resolve(dir))) throw new Error("unauthorized project dir");
}

function assertInside(dir, rel) {
  const base = path.resolve(dir);
  const full = path.resolve(base, rel);
  if (full === base || !full.startsWith(base + path.sep)) throw new Error("path escapes project dir: " + rel);
  return full;
}

function recentJsonPath() {
  return path.join(app.getPath("userData"), "recent.json");
}

function isValidRecentEntry(e) {
  return e && typeof e.id === "string" && typeof e.name === "string" && typeof e.path === "string";
}

function loadRecent() {
  try {
    const parsed = JSON.parse(fs.readFileSync(recentJsonPath(), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecentEntry);
  } catch {
    return [];
  }
}

function saveRecent(entries) {
  const p = recentJsonPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries));
}

// Load recent project paths into authorizedDirs on startup (called from app.whenReady below)

let nextPick = null;

ipcMain.handle("project:__setNextPick", (_e, p) => {
  if (process.env.PALMIER_E2E !== "1") throw new Error("test-only");
  nextPick = p;
});

let nextExportPick = null;

ipcMain.handle("project:__setNextExportPick", (_e, p) => {
  if (process.env.PALMIER_E2E !== "1") throw new Error("test-only");
  nextExportPick = p;
});

ipcMain.handle("project:pickExportSave", async (_e, suggestedName) => {
  let p;
  if (nextExportPick) {
    p = nextExportPick;
    nextExportPick = null;
  } else {
    const r = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: [
        { name: "MP4 video", extensions: ["mp4"] },
        { name: "QuickTime", extensions: ["mov"] },
      ],
    });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
  }
  authorize(path.dirname(p));
  return p;
});

ipcMain.handle("project:pickOpen", async () => {
  if (nextPick) {
    const p = nextPick;
    nextPick = null;
    authorize(p);
    return p;
  }
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  authorize(r.filePaths[0]);
  return r.filePaths[0];
});

ipcMain.handle("project:pickSaveAs", async (_e, _name) => {
  if (nextPick) {
    const p = nextPick;
    nextPick = null;
    fs.mkdirSync(p, { recursive: true });
    authorize(p);
    return p;
  }
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  fs.mkdirSync(p, { recursive: true });
  authorize(p);
  return p;
});

ipcMain.handle("project:readText", (_e, dir, name) => {
  assertAuthorized(dir);
  const f = assertInside(dir, name);
  try {
    return fs.readFileSync(f, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
});

ipcMain.handle("project:writeText", (_e, dir, name, data) => {
  assertAuthorized(dir);
  const f = assertInside(dir, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
});

ipcMain.handle("project:writeMedia", (_e, dir, rel, bytes) => {
  assertAuthorized(dir);
  const f = assertInside(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(bytes));
});

ipcMain.handle("project:readMedia", (_e, dir, rel) => {
  assertAuthorized(dir);
  const f = assertInside(dir, rel);
  try {
    return new Uint8Array(fs.readFileSync(f));
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("media not found: " + rel);
    throw e;
  }
});

ipcMain.handle("project:hasMedia", (_e, dir, rel) => {
  assertAuthorized(dir);
  return fs.existsSync(assertInside(dir, rel));
});

ipcMain.handle("project:listRecent", () => {
  return loadRecent().slice(0, 10);
});

ipcMain.handle("project:addRecent", (_e, rec) => {
  if (!isValidRecentEntry(rec)) throw new Error("invalid recent entry shape");
  assertAuthorized(rec.path); // only user-picked paths may enter recent.json
  let entries = loadRecent();
  entries = [rec, ...entries.filter((e) => e.id !== rec.id && e.path !== rec.path)].slice(0, 10);
  saveRecent(entries);
  rebuildMenu();
});

ipcMain.handle("project:removeRecent", (_e, id) => {
  const entries = loadRecent().filter((e) => e.id !== id);
  saveRecent(entries);
  rebuildMenu();
});

// ── Window state persistence ─────────────────────────────────────────────────

function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(windowStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { width: 1280, height: 800 };
    const { x, y, width, height } = parsed;
    if (
      typeof width !== "number" || typeof height !== "number" ||
      typeof x !== "number" || typeof y !== "number"
    ) return { width: 1280, height: 800 };
    return { x, y, width, height };
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveWindowState(bounds) {
  try {
    const p = windowStatePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }));
  } catch { /* never throw */ }
}

function createWindow() {
  const bounds = loadWindowState();
  const win = new BrowserWindow({
    ...bounds,
    show: true,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      experimentalFeatures: true,
    },
  });

  let debounceTimer = null;
  function scheduleSave() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { saveWindowState(win.getBounds()); }, 300);
  }

  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", () => {
    clearTimeout(debounceTimer);
    saveWindowState(win.getBounds());
  });

  const rendererPort = process.env.RENDERER_PORT || "5190";
  win.loadURL(`http://localhost:${rendererPort}/editor.html`);
}

// ── Menu with Open Recent submenu ────────────────────────────────────────────

function buildMenu() {
  const recent = loadRecent();
  const recentItems = recent.length > 0
    ? recent.map((ref) => ({
        label: ref.name,
        click: (_i, win) => win?.webContents.send("menu:command", "open-recent", ref),
      }))
    : [{ label: "No Recent Projects", enabled: false }];

  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "New",
          accelerator: "CmdOrCtrl+N",
          click: (_i, win) => win?.webContents.send("menu:command", "new"),
        },
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: (_i, win) => win?.webContents.send("menu:command", "open"),
        },
        {
          label: "Open Recent",
          submenu: recentItems,
        },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: (_i, win) => win?.webContents.send("menu:command", "save"),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: (_i, win) => win?.webContents.send("menu:command", "save-as"),
        },
        {
          label: "Export…",
          accelerator: "CmdOrCtrl+E",
          click: (_i, win) => win?.webContents.send("menu:command", "export"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
      ],
    },
  ]);
}

function rebuildMenu() {
  Menu.setApplicationMenu(buildMenu());
}

app.whenReady().then(async () => {
  // recent.json only ever holds user-picked (authorized) paths — see addRecent's assertAuthorized — so authorizing them on startup is safe.
  const recent = loadRecent();
  for (const entry of recent) {
    if (entry && typeof entry.path === "string") authorize(entry.path);
  }

  // Initialize MCP token (requires userData path, available after app.whenReady)
  _mcpToken = loadOrCreateToken();

  // Restore MCP server if previously enabled
  if (readEnabled()) {
    try {
      const mod = await import("./mcp/server.mjs");
      _mcpServer = await mod.startMcpServer({ port: MCP_PORT, token: _mcpToken, bridge: mcpBridge });
    } catch { /* not fatal */ }
  }

  // The audio engine needs SharedArrayBuffer, which requires a cross-origin-isolated renderer.
  // Inject COOP/COEP on every response so crossOriginIsolated is true (dev + packaged).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": ["same-origin"],
        "Cross-Origin-Embedder-Policy": ["require-corp"],
      },
    });
  });

  rebuildMenu();
  createWindow();
});

app.on("before-quit", async () => {
  if (_mcpServer) {
    await _mcpServer.close();
    _mcpServer = null;
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

// ── Spike IPC (Task 2) ──────────────────────────────────────────────────────

ipcMain.handle("spike:encode-frame", async (_event, rgba, w, h) => {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w > 8192 || h > 8192) {
    throw new Error("invalid frame dimensions");
  }

  let ffmpegPath;
  try {
    ffmpegPath = require("ffmpeg-static");
  } catch (e) {
    throw new Error("ffmpeg-static not found: " + e.message);
  }

  const outPath = path.join(os.tmpdir(), `spike-${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${w}x${h}`,
      "-framerate", "1",
      "-i", "pipe:0",
      "-frames:v", "1",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      outPath,
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => reject(new Error("ffmpeg spawn error: " + err.message)));
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(outPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}. stderr: ${stderr.slice(-500)}`));
      }
    });

    const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    proc.stdin.write(buf);
    proc.stdin.end();
  });
});

// ── Export IPC (Task 3) ─────────────────────────────────────────────────────
// Audio approach: buffer audio frames to a temp .f32le file as they arrive,
// then on finish do a two-pass mux: first encode video-only, then re-mux with
// the audio temp file. If no audio, single ffmpeg pass.

/** @type {Map<string, { ffmpegPath: string, opts: any, videoProc: any, audioPath: string|null, audioFd: number|null, videoPath: string, id: string }>} */
const exportSessions = new Map();
let sessionCounter = 0;

// We only support one concurrent export from a single renderer window,
// but use a session ID so the protocol is forward-compatible.
let activeSession = null;

const CODECS = {
  prores_ks: { ext: ".mov", vargs: ["-c:v", "prores_ks", "-profile:v", "3"] },
  libx264: { ext: ".mp4", vargs: ["-c:v", "libx264", "-pix_fmt", "yuv420p"] },
};

ipcMain.handle("export:start", async (_event, { width, height, fps, audio, codec, outPath }) => {
  if (activeSession !== null) {
    throw new Error("export already in progress; call export:finish first");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 8192 || height > 8192) {
    throw new Error("invalid export dimensions");
  }

  // Codec allowlist — reject anything not in the map
  const spec = CODECS[codec];
  if (!spec) throw new Error("unsupported codec: " + String(codec));

  // Output-path containment — must be in an authorized dir (user-picked via pickExportSave) or in os.tmpdir() (test harness only)
  const resolved = path.resolve(outPath);
  const outDir = path.dirname(resolved);
  const tmpRoot = path.resolve(os.tmpdir());
  const inTmp = outDir === tmpRoot || outDir.startsWith(tmpRoot + path.sep);
  if (!inTmp) assertAuthorized(outDir);

  let ffmpegPath;
  try {
    ffmpegPath = require("ffmpeg-static");
  } catch (e) {
    throw new Error("ffmpeg-static not found: " + e.message);
  }

  const id = String(++sessionCounter);
  const videoOnlyPath = audio ? path.join(os.tmpdir(), `export-vid-${id}${spec.ext}`) : resolved;
  const audioPath = audio ? path.join(os.tmpdir(), `export-aud-${id}.f32le`) : null;

  let audioFd = null;
  let videoProc = null;
  try {
    // Open audio temp file for writing if we have audio
    if (audioPath) {
      audioFd = fs.openSync(audioPath, "w");
    }

    const videoArgs = [
      "-y",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${width}x${height}`,
      "-r", String(fps),
      "-i", "pipe:0",
      ...spec.vargs,
      videoOnlyPath,
    ];

    videoProc = spawn(ffmpegPath, videoArgs, { stdio: ["pipe", "pipe", "pipe"] });

    let videoStderr = "";
    videoProc.stderr.on("data", (d) => { videoStderr += d.toString(); });
    videoProc.on("error", (err) => { videoStderr += "\nspawn error: " + err.message; });

    const session = { ffmpegPath, opts: { width, height, fps, audio, codec, outPath: resolved }, videoProc, videoStderr: () => videoStderr, audioPath, audioFd, videoOnlyPath, id };
    exportSessions.set(id, session);
    activeSession = id;
  } catch (e) {
    try { if (audioFd != null) fs.closeSync(audioFd); } catch {}
    activeSession = null;
    throw e;
  }

  return id;
});

ipcMain.on("export:video-frame", (_event, buf) => {
  if (!activeSession) return;
  const session = exportSessions.get(activeSession);
  if (!session) return;
  const frame = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  session.videoProc.stdin.write(frame);
});

ipcMain.on("export:audio-data", (_event, buf) => {
  if (!activeSession) return;
  const session = exportSessions.get(activeSession);
  if (!session || !session.audioFd) return;
  const data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  fs.writeSync(session.audioFd, data);
});

ipcMain.handle("export:finish", async (_event) => {
  const id = activeSession;
  if (!id) throw new Error("no active export session");
  const session = exportSessions.get(id);
  if (!session) throw new Error("export session not found: " + id);

  exportSessions.delete(id);
  activeSession = null;

  // End video stdin and wait for ffmpeg
  await new Promise((resolve, reject) => {
    session.videoProc.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`ffmpeg video pass exited ${code}. stderr: ${session.videoStderr().slice(-800)}`));
    });
    session.videoProc.stdin.end();
  });

  // Close audio temp file
  if (session.audioFd !== null) {
    fs.closeSync(session.audioFd);
  }

  const { opts, audioPath, videoOnlyPath, ffmpegPath } = session;

  if (!audioPath) {
    // No audio — video-only path is already the final outPath
    return opts.outPath;
  }

  // Two-pass mux: combine video-only file + raw audio into final output
  const { audio } = opts;
  await new Promise((resolve, reject) => {
    const muxArgs = [
      "-y",
      "-i", videoOnlyPath,
      "-f", "f32le",
      "-ar", String(audio.sampleRate),
      "-ac", String(audio.channels),
      "-i", audioPath,
      "-map", "0:v",
      "-map", "1:a",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      opts.outPath,
    ];

    const muxProc = spawn(ffmpegPath, muxArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let muxStderr = "";
    muxProc.stderr.on("data", (d) => { muxStderr += d.toString(); });
    muxProc.on("error", (err) => reject(new Error("ffmpeg mux spawn error: " + err.message)));
    muxProc.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`ffmpeg mux exited ${code}. stderr: ${muxStderr.slice(-800)}`));
    });
  });

  // Cleanup temp files
  try { fs.unlinkSync(videoOnlyPath); } catch { /* ignore */ }
  try { fs.unlinkSync(audioPath); } catch { /* ignore */ }

  return opts.outPath;
});

// ── AI IPC (DesktopAiGateway) ────────────────────────────────────────────────
// Provider API keys are stored exclusively in the main process (never in renderer).
// In production: safeStorage (OS keychain encryption).
// In headless CI (PALMIER_E2E=1): plain file fallback when safeStorage unavailable.

const KEY_FILES = {
  openrouter: {
    enc: path.join(app.getPath("userData"), "openrouter-key.bin"),
    plain: path.join(app.getPath("userData"), "openrouter-key-plain.txt"),
  },
  fal: {
    enc: path.join(app.getPath("userData"), "fal-key.bin"),
    plain: path.join(app.getPath("userData"), "fal-key-plain.txt"),
  },
};

function keyFiles(provider) {
  return KEY_FILES[provider] || KEY_FILES.openrouter;
}

function loadKey(provider) {
  const { enc, plain } = keyFiles(provider);
  try {
    const isE2E = process.env.PALMIER_E2E === "1";
    if (isE2E && !safeStorage.isEncryptionAvailable()) {
      // Headless CI fallback: plain text store
      if (!fs.existsSync(plain)) return null;
      return fs.readFileSync(plain, "utf8");
    }
    if (!fs.existsSync(enc)) return null;
    return safeStorage.decryptString(fs.readFileSync(enc));
  } catch {
    return null;
  }
}

ipcMain.handle("ai:setKey", (_e, key, provider) => {
  const { enc, plain } = keyFiles(provider);
  const isE2E = process.env.PALMIER_E2E === "1";
  if (isE2E && !safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(plain, String(key), "utf8");
    return;
  }
  fs.writeFileSync(enc, safeStorage.encryptString(String(key)));
});

ipcMain.handle("ai:hasKey", (_e, provider) => {
  const { enc, plain } = keyFiles(provider);
  const isE2E = process.env.PALMIER_E2E === "1";
  if (isE2E && !safeStorage.isEncryptionAvailable()) return fs.existsSync(plain);
  return fs.existsSync(enc);
});

ipcMain.handle("ai:clearKey", (_e, provider) => {
  const { enc, plain } = keyFiles(provider);
  try { fs.unlinkSync(enc); } catch { /* ignore */ }
  try { fs.unlinkSync(plain); } catch { /* ignore */ }
});

ipcMain.handle("ai:generateImage", async (_e, body) => {
  const key = loadKey("openrouter");
  if (!key) throw new Error("no API key");
  const base = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://palmier.pro",
      "X-Title": "PalmierPro",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
});

ipcMain.on("ai:streamChat", async (event, { id, body }) => {
  const key = loadKey("openrouter");
  if (!key) {
    event.sender.send("ai:chunk", { id, error: "no API key" });
    return;
  }
  try {
    const base = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://palmier.pro",
        "X-Title": "PalmierPro",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      event.sender.send("ai:chunk", { id, error: "HTTP " + res.status });
      return;
    }
    for await (const chunk of res.body) {
      event.sender.send("ai:chunk", { id, data: new Uint8Array(chunk) });
    }
    event.sender.send("ai:chunk", { id, done: true });
  } catch (err) {
    event.sender.send("ai:chunk", { id, error: String(err) });
  }
});

// ── Generation IPC (DesktopGenGateway / fal.ai queue) ───────────────────────
// The fal.ai key never enters the renderer — main fetches queue.fal.run directly.
// URL shape mirrors packages/ai/src/generation/fal-wire.ts (main is CJS and can't
// import that ESM package, so the builders are re-inlined here — keep in sync).

const FAL_QUEUE_BASE = "https://queue.fal.run";
const falSubmitUrl = (modelEndpoint) => `${FAL_QUEUE_BASE}/${modelEndpoint}`;
const falStatusUrl = (modelEndpoint, jobId) => `${FAL_QUEUE_BASE}/${modelEndpoint}/requests/${jobId}/status`;
const falResultUrl = (modelEndpoint, jobId) => `${FAL_QUEUE_BASE}/${modelEndpoint}/requests/${jobId}`;

// Storage upload — REST host, not the queue host (verified against fal-js; see FAL_REST_BASE
// in fal-wire.ts for the full contract note).
const FAL_REST_BASE = "https://rest.fal.ai";
const falUploadInitiateUrl = () => `${FAL_REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3`;

function isAllowedFalHost(url) {
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  return (
    host === "fal.ai" || host.endsWith(".fal.ai") ||
    host === "fal.run" || host.endsWith(".fal.run") ||
    host === "fal.media" || host.endsWith(".fal.media")
  );
}

ipcMain.handle("gen:falSubmit", async (_e, { modelEndpoint, input }) => {
  const key = loadKey("fal");
  if (!key) return { error: "fal key not configured" };
  try {
    const res = await fetch(falSubmitUrl(modelEndpoint), {
      method: "POST",
      headers: { Authorization: "Key " + key, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { error: res.status + " " + (await res.text()) };
    const json = await res.json();
    const jobId = json && typeof json.request_id === "string" ? json.request_id : null;
    if (!jobId) return { error: "fal submit response missing request_id" };
    return { jobId };
  } catch (err) {
    return { error: String(err) };
  }
});

ipcMain.handle("gen:falStatus", async (_e, { modelEndpoint, jobId }) => {
  const key = loadKey("fal");
  if (!key) return { error: "fal key not configured" };
  try {
    const res = await fetch(falStatusUrl(modelEndpoint, jobId), { headers: { Authorization: "Key " + key } });
    if (!res.ok) return { error: res.status + " " + (await res.text()) };
    const status = await res.json();
    if (!status || status.status !== "COMPLETED") return { status };
    const resultRes = await fetch(falResultUrl(modelEndpoint, jobId), { headers: { Authorization: "Key " + key } });
    if (!resultRes.ok) return { error: resultRes.status + " " + (await resultRes.text()) };
    return { status, resultJson: await resultRes.json() };
  } catch (err) {
    return { error: String(err) };
  }
});

ipcMain.handle("gen:falDownload", async (_e, { url }) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: res.status + " " + (await res.text()) };
    return { data: await res.arrayBuffer() };
  } catch (err) {
    return { error: String(err) };
  }
});

ipcMain.handle("gen:falUpload", async (_e, { bytes, contentType, fileName }) => {
  const key = loadKey("fal");
  if (!key) return { error: "fal key not configured" };
  try {
    const initiateRes = await fetch(falUploadInitiateUrl(), {
      method: "POST",
      headers: { Authorization: "Key " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: contentType, file_name: fileName }),
    });
    if (!initiateRes.ok) return { error: initiateRes.status + " " + (await initiateRes.text()) };
    const initJson = await initiateRes.json();
    const uploadUrl = initJson && typeof initJson.upload_url === "string" ? initJson.upload_url : null;
    const fileUrl = initJson && typeof initJson.file_url === "string" ? initJson.file_url : null;
    if (!uploadUrl || !fileUrl) return { error: "fal upload/initiate response missing upload_url/file_url" };

    let uploadTarget, fileTarget;
    try {
      uploadTarget = new URL(uploadUrl);
      fileTarget = new URL(fileUrl);
    } catch {
      return { error: "fal upload/initiate returned an invalid URL" };
    }
    if (!isAllowedFalHost(uploadTarget) || !isAllowedFalHost(fileTarget)) {
      return { error: "fal upload URL host not allowed" };
    }

    const putRes = await fetch(uploadTarget.toString(), {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: Buffer.from(bytes),
    });
    if (!putRes.ok) return { error: "fal storage PUT failed: " + putRes.status };
    return { url: fileUrl };
  } catch (err) {
    return { error: String(err) };
  }
});

// ── Media IPC (audio extraction for transcription) ──────────────────────────
// mono 16kHz PCM16 WAV via ffmpeg. Exactly one of {path, bytes}: unsaved media
// (in-memory only) pipes bytes to stdin, else ffmpeg reads the resolved on-disk path.

ipcMain.handle("media:extractAudio", async (_e, { path: mediaPath, bytes }) => {
  if ((mediaPath == null) === (bytes == null)) {
    return { error: "media:extractAudio requires exactly one of path or bytes" };
  }

  let ffmpegPath;
  try {
    ffmpegPath = require("ffmpeg-static");
  } catch (e) {
    return { error: "ffmpeg-static not found: " + e.message };
  }

  const args = [
    "-i", mediaPath != null ? mediaPath : "pipe:0",
    "-vn", "-ac", "1", "-ar", "16000",
    "-f", "wav", "pipe:1",
  ];

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks = [];
    let stderr = "";

    proc.stdout.on("data", (d) => stdoutChunks.push(d));
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.stdin.on("error", () => { /* EPIPE when ffmpeg exits before stdin is fully written */ });
    proc.on("error", (err) => resolve({ error: "ffmpeg spawn error: " + err.message }));
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ error: `ffmpeg exited with code ${code}. stderr: ${stderr.slice(-500)}` });
        return;
      }
      const wav = Buffer.concat(stdoutChunks);
      const durationSeconds = Math.max(0, (wav.length - 44) / (16000 * 2));
      resolve({ wav: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength), durationSeconds });
    });

    if (bytes != null) proc.stdin.write(Buffer.from(bytes));
    proc.stdin.end();
  });
});

// ── Media import IPC (path/url sources for import_media, M12A T3) ──────────
// Bytes never cross IPC in bulk: main copies/downloads straight into the project media dir; the
// renderer only ever sees {abs, rel, ext, size} scan results and reads the finished file back via
// the existing project:readMedia path to probe it. The extension allowlist mirrors packages/ai's
// IMPORT_EXT_TO_TYPE (main is CJS and can't import that ESM package — keep in sync manually, same
// convention as the fal URL builders above).

const IMPORT_ALLOWED_EXTENSIONS = new Set([
  "mp4", "mov",
  "mp3", "wav", "aac", "m4a", "aiff", "aifc", "flac",
  "png", "jpg", "jpeg", "tiff", "heic",
]);

const IMPORT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 15 * 60 * 1000;

function importExt(p) {
  return path.extname(p).slice(1).toLowerCase();
}

// General-host SSRF guard (any https origin, not an allowlist): denies credentials, non-https,
// "localhost", and any literal IP host (v4 or v6) — see apps/proxy/src/server.ts's
// isAllowedImportHost for the identical web-side treatment and the reasoning. This is a fast
// syntax-only pre-filter; it does NOT by itself stop DNS-rebinding (an ordinary-looking hostname
// whose DNS record points at a private/metadata IP) — see validateImportTarget below, which
// mirrors apps/proxy/src/ssrf-guard.ts's (tested) isPrivateAddress/checkHostResolution logic
// exactly. Main is CJS and can't import that ESM module, so it's duplicated here — keep in sync
// manually, same convention as the fal URL builders above.
function isAllowedImportHost(url) {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  if (host.startsWith("[") && host.endsWith("]")) return false;
  return true;
}

// ── SSRF: DNS-rebinding guard (mirrors apps/proxy/src/ssrf-guard.ts's isPrivateAddress) ─────────

function parseIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function isPrivateIPv4(a, b, c, d) {
  void c;
  void d;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local, incl. cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  return false;
}

// Expands any legal IPv6 textual form (incl. "::" compression, zone IDs, and a trailing
// dotted-quad tail like "::ffff:1.2.3.4") into 8 16-bit groups, or null if unparseable.
function expandIPv6Groups(input) {
  let addr = input;
  const pct = addr.indexOf("%");
  if (pct !== -1) addr = addr.slice(0, pct); // strip zone id, e.g. fe80::1%eth0

  const v4Tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (v4Tail) {
    const v4 = parseIPv4(v4Tail[2]);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    addr = v4Tail[1] + hi + ":" + lo;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

  let groups;
  if (halves.length === 1) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;

  const nums = groups.map((g) => (g === "" ? 0 : parseInt(g, 16)));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function isPrivateIPv6(groups) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // IPv4-mapped: ::ffff:a.b.c.d — unmap and re-check the v4 rules.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const a = (g6 >> 8) & 0xff;
    const b = g6 & 0xff;
    const c = (g7 >> 8) & 0xff;
    const d = g7 & 0xff;
    return isPrivateIPv4(a, b, c, d);
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 (unique local)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  return false;
}

function isPrivateAddress(ip) {
  if (ip.includes(":")) {
    const groups = expandIPv6Groups(ip);
    if (!groups) return true; // unparseable → fail closed
    return isPrivateIPv6(groups);
  }
  const v4 = parseIPv4(ip);
  if (!v4) return true; // unparseable → fail closed
  return isPrivateIPv4(...v4);
}

// Resolves the hostname and rejects if ANY returned address is private (multi-A-record rebinding
// defense). DNS failures fail closed (denied), same posture as a private address.
async function checkHostResolution(hostname) {
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    return { ok: false };
  }
  if (addresses.length === 0) return { ok: false };
  if (addresses.some((a) => isPrivateAddress(a.address))) return { ok: false };
  return { ok: true, addresses };
}

// Syntax check + DNS resolution + private-address rejection, run before the initial fetch and
// again on every redirect hop. Returns the resolved address to pin the connection to.
async function validateImportTarget(url) {
  if (!isAllowedImportHost(url)) return { ok: false };
  const resolution = await checkHostResolution(url.hostname);
  if (!resolution.ok) return { ok: false };
  const pinnedAddress = resolution.addresses[0];
  if (!pinnedAddress) return { ok: false };
  return { ok: true, pinnedAddress };
}

// Pins the connection to the exact address we just validated instead of trusting a second,
// independent DNS lookup at connect time (closes the TOCTOU window between "we checked this
// hostname" and "the socket actually connects").
function createPinnedDispatcher(pinnedAddress) {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
      },
    },
  });
}

// Bounded, async, symlink-safe directory walk: a synchronous unbounded recursion here would
// freeze the whole Electron main process (all windows, all IPC, native menus) on a huge tree
// (a home directory, node_modules, or a drive root), and — reachable via import_media's `path`
// argument, potentially from an untrusted MCP source — is a real DoS surface. fs.promises keeps
// I/O off the main thread; the depth/file caps bound worst-case work; lstat + skipping symlinks
// (rather than Dirent.isDirectory()/isFile(), which can misreport reparse points on some
// Node/libuv versions) means a symlink/junction loop can't cause infinite recursion.
const IMPORT_MAX_SCAN_DEPTH = 8;
const IMPORT_MAX_SCAN_FILES = 500;

async function walkImportDir(root, relDir, files, dirs, depth) {
  if (depth > IMPORT_MAX_SCAN_DEPTH) {
    throw new Error(`Directory too deep to import (over ${IMPORT_MAX_SCAN_DEPTH} levels)`);
  }
  const absDir = relDir ? path.join(root, relDir) : root;
  let entries;
  try {
    entries = await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const entRel = relDir ? `${relDir}/${ent.name}` : ent.name;
    const entAbs = path.join(absDir, ent.name);
    let st;
    try {
      st = await fs.promises.lstat(entAbs);
    } catch {
      continue; // unreadable, skip
    }
    if (st.isSymbolicLink()) continue; // never follow symlinks/junctions/reparse points
    if (st.isDirectory()) {
      dirs.push(entRel);
      await walkImportDir(root, entRel, files, dirs, depth + 1);
    } else if (st.isFile()) {
      const ext = importExt(ent.name);
      if (!IMPORT_ALLOWED_EXTENSIONS.has(ext)) continue;
      if (files.length >= IMPORT_MAX_SCAN_FILES) {
        throw new Error(`Directory too large to import (over ${IMPORT_MAX_SCAN_FILES} media files)`);
      }
      files.push({ abs: entAbs, rel: entRel, ext, size: st.size });
    }
  }
}

ipcMain.handle("media:importScan", async (_e, dir, absPath) => {
  assertAuthorized(dir);
  const resolvedDir = path.resolve(dir);
  const resolvedTarget = path.resolve(absPath);
  if (resolvedTarget === resolvedDir || resolvedTarget.startsWith(resolvedDir + path.sep)) {
    return { error: "cannot import a path inside the project directory" };
  }

  let stat;
  try {
    stat = await fs.promises.stat(resolvedTarget);
  } catch {
    return { error: "path not found: " + absPath };
  }

  if (stat.isFile()) {
    const ext = importExt(resolvedTarget);
    const files = IMPORT_ALLOWED_EXTENSIONS.has(ext)
      ? [{ abs: resolvedTarget, rel: path.basename(resolvedTarget), ext, size: stat.size }]
      : [];
    return { files, dirs: [] };
  }
  if (!stat.isDirectory()) {
    return { error: "unsupported path type: " + absPath };
  }

  const files = [];
  const dirs = [];
  try {
    await walkImportDir(resolvedTarget, "", files, dirs, 0);
  } catch (e) {
    return { error: e.message };
  }
  return { files, dirs };
});

ipcMain.handle("media:importCopy", (_e, dir, absPath, relPath) => {
  assertAuthorized(dir);
  const ext = importExt(absPath);
  if (!IMPORT_ALLOWED_EXTENSIONS.has(ext)) return { error: "unsupported file extension: ." + ext };
  const dest = assertInside(dir, relPath);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absPath, dest);
  } catch (e) {
    return { error: "copy failed: " + e.message };
  }
  return { ok: true };
});

ipcMain.handle("media:importDownload", async (_e, dir, url, relPath) => {
  assertAuthorized(dir);
  const ext = importExt(relPath);
  if (!IMPORT_ALLOWED_EXTENSIONS.has(ext)) return { error: "unsupported file extension: ." + ext };
  const dest = assertInside(dir, relPath);

  let target;
  try {
    target = new URL(url);
  } catch {
    return { error: "invalid url" };
  }
  const initialValidation = await validateImportTarget(target);
  if (!initialValidation.ok) return { error: "url host not allowed" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
  let dispatcher = createPinnedDispatcher(initialValidation.pinnedAddress);
  // tmp/renamed track the .part temp file so ANY failure below (timeout, network error, size
  // cap, write error) unlinks it in the finally — not just the size-cap branch.
  let tmp = null;
  let renamed = false;
  try {
    // Follow redirects manually so every hop is re-resolved, re-validated, and re-pinned.
    let res = await fetch(target.toString(), { redirect: "manual", signal: controller.signal, dispatcher });
    for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400; hop++) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, target);
      const hopValidation = await validateImportTarget(next);
      if (!hopValidation.ok) return { error: "redirect host not allowed" };
      target = next;
      const prevDispatcher = dispatcher;
      dispatcher = createPinnedDispatcher(hopValidation.pinnedAddress);
      void prevDispatcher.close();
      res = await fetch(target.toString(), { redirect: "manual", signal: controller.signal, dispatcher });
    }
    if (res.status >= 300 && res.status < 400) return { error: "too many redirects" };
    if (!res.ok) return { error: "server returned HTTP " + res.status };

    const declaredLength = res.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > IMPORT_MAX_BYTES) {
      return { error: "remote file exceeds the size cap" };
    }
    if (!res.body) return { error: "empty response body" };

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    tmp = dest + ".part";
    const fd = fs.openSync(tmp, "w");
    let total = 0;
    try {
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > IMPORT_MAX_BYTES) {
          return { error: "remote file exceeds the size cap" };
        }
        fs.writeSync(fd, Buffer.from(chunk));
      }
    } finally {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    fs.renameSync(tmp, dest);
    renamed = true;
    return { ok: true, size: total };
  } catch (err) {
    return { error: String(err) };
  } finally {
    clearTimeout(timer);
    void dispatcher.close();
    if (tmp && !renamed) {
      try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
    }
  }
});
