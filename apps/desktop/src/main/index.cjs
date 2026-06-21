"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

// Enable WebGPU in the renderer
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
      // Allow webgpu in renderer
      experimentalFeatures: true,
    },
  });

  // Load Vite dev server URL (started externally by Playwright webServer)
  const rendererPort = process.env.RENDERER_PORT || "5190";
  win.loadURL(`http://localhost:${rendererPort}`);
}

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

// IPC: encode one RGBA frame via ffmpeg-static
ipcMain.handle("spike:encode-frame", async (_event, rgba, w, h) => {
  // ffmpeg-static returns path to the ffmpeg binary
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

    // Write RGBA bytes to stdin, then close
    const buf = Buffer.from(rgba.buffer || rgba);
    proc.stdin.write(buf);
    proc.stdin.end();
  });
});
