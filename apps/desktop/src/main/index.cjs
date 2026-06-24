"use strict";

const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

// ── MCP server state ─────────────────────────────────────────────────────────

const MCP_PORT = Number(process.env.MCP_PORT) || 19789;

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
    _mcpServer = await mod.startMcpServer({ port: MCP_PORT, token: _mcpToken });
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
    _mcpServer = await mod.startMcpServer({ port: MCP_PORT, token: _mcpToken });
  }
  return _mcpToken;
});

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");

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
      _mcpServer = await mod.startMcpServer({ port: MCP_PORT, token: _mcpToken });
    } catch { /* not fatal */ }
  }

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
// The OpenRouter API key is stored exclusively in the main process (never in renderer).
// In production: safeStorage (OS keychain encryption).
// In headless CI (PALMIER_E2E=1): plain file fallback when safeStorage unavailable.

const AI_KEY_FILE = path.join(app.getPath("userData"), "openrouter-key.bin");
const AI_KEY_FILE_PLAIN = path.join(app.getPath("userData"), "openrouter-key-plain.txt");

function loadKey() {
  try {
    const isE2E = process.env.PALMIER_E2E === "1";
    if (isE2E && !safeStorage.isEncryptionAvailable()) {
      // Headless CI fallback: plain text store
      if (!fs.existsSync(AI_KEY_FILE_PLAIN)) return null;
      return fs.readFileSync(AI_KEY_FILE_PLAIN, "utf8");
    }
    if (!fs.existsSync(AI_KEY_FILE)) return null;
    return safeStorage.decryptString(fs.readFileSync(AI_KEY_FILE));
  } catch {
    return null;
  }
}

ipcMain.handle("ai:setKey", (_e, key) => {
  const isE2E = process.env.PALMIER_E2E === "1";
  if (isE2E && !safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(AI_KEY_FILE_PLAIN, String(key), "utf8");
    return;
  }
  fs.writeFileSync(AI_KEY_FILE, safeStorage.encryptString(String(key)));
});

ipcMain.handle("ai:hasKey", () => {
  const isE2E = process.env.PALMIER_E2E === "1";
  if (isE2E && !safeStorage.isEncryptionAvailable()) return fs.existsSync(AI_KEY_FILE_PLAIN);
  return fs.existsSync(AI_KEY_FILE);
});

ipcMain.handle("ai:clearKey", () => {
  try { fs.unlinkSync(AI_KEY_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(AI_KEY_FILE_PLAIN); } catch { /* ignore */ }
});

ipcMain.handle("ai:generateImage", async (_e, body) => {
  const key = loadKey();
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
  const key = loadKey();
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
