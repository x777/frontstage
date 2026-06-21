"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      experimentalFeatures: true,
    },
  });

  const rendererPort = process.env.RENDERER_PORT || "5190";
  win.loadURL(`http://localhost:${rendererPort}`);
}

app.whenReady().then(() => {
  createWindow();
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

ipcMain.handle("export:start", async (_event, { width, height, fps, audio, codec, outPath }) => {
  if (activeSession !== null) {
    throw new Error("export already in progress; call export:finish first");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 8192 || height > 8192) {
    throw new Error("invalid export dimensions");
  }

  let ffmpegPath;
  try {
    ffmpegPath = require("ffmpeg-static");
  } catch (e) {
    throw new Error("ffmpeg-static not found: " + e.message);
  }

  const id = String(++sessionCounter);
  const vidExt = codec === "prores_ks" ? ".mov" : ".mp4";
  const videoOnlyPath = audio ? path.join(os.tmpdir(), `export-vid-${id}${vidExt}`) : outPath;
  const audioPath = audio ? path.join(os.tmpdir(), `export-aud-${id}.f32le`) : null;

  // Open audio temp file for writing if we have audio
  let audioFd = null;
  if (audioPath) {
    audioFd = fs.openSync(audioPath, "w");
  }

  // Determine pixel format output for codec
  const pixFmt = codec === "prores_ks" ? "yuv444p10le" : "yuv420p";
  const videoArgs = [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${width}x${height}`,
    "-r", String(fps),
    "-i", "pipe:0",
    "-c:v", codec,
    ...(codec === "prores_ks" ? ["-profile:v", "3"] : ["-pix_fmt", pixFmt]),
    videoOnlyPath,
  ];

  const videoProc = spawn(ffmpegPath, videoArgs, { stdio: ["pipe", "pipe", "pipe"] });

  let videoStderr = "";
  videoProc.stderr.on("data", (d) => { videoStderr += d.toString(); });
  videoProc.on("error", (err) => { videoStderr += "\nspawn error: " + err.message; });

  const session = { ffmpegPath, opts: { width, height, fps, audio, codec, outPath }, videoProc, videoStderr: () => videoStderr, audioPath, audioFd, videoOnlyPath, id };
  exportSessions.set(id, session);
  activeSession = id;

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
