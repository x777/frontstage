import { FfmpegIpcSink } from "./ffmpeg-sink.js";

declare global {
  interface Window {
    desktopExport: {
      start(opts: { width: number; height: number; fps: number; audio?: { sampleRate: number; channels: number }; codec: string; outPath: string }): Promise<string>;
      videoFrame(buf: Uint8Array): void;
      audioData(buf: Uint8Array): void;
      finish(): Promise<string>;
    };
    __runDesktopExport: ((codec: string, outPath: string) => Promise<string>) | undefined;
    __exportStatus: string;
  }
}

const W = 320;
const H = 240;
const FPS = 30;
const DURATION_FRAMES = 20;

window.__exportStatus = "export-init";

async function setup(): Promise<void> {
  try {
    window.__runDesktopExport = async (codec: string, outPath: string): Promise<string> => {
      const sink = new FfmpegIpcSink(window.desktopExport, { codec, outPath });
      await sink.configure({ width: W, height: H, fps: FPS });

      // Generate synthetic RGBA frames using 2D canvas (no WebGPU dependency)
      const canvas = new OffscreenCanvas(W, H);
      const ctx = canvas.getContext("2d")!;

      for (let i = 0; i < DURATION_FRAMES; i++) {
        // Draw a gradient that changes per frame to produce a valid video
        const hue = (i / DURATION_FRAMES) * 360;
        ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
        ctx.fillRect(0, 0, W, H);

        const timestamp = Math.round(i * 1e6 / FPS);
        const duration = Math.round(1e6 / FPS);
        const vf = new VideoFrame(canvas, { timestamp, duration });
        try {
          await sink.ready();
          await sink.pushVideoFrame(vf, { keyFrame: i === 0 });
        } finally {
          vf.close();
        }
      }

      await sink.finalize();
      return outPath;
    };

    window.__exportStatus = "ready";
    const el = document.getElementById("export-status");
    if (el) el.textContent = "ready";
  } catch (e) {
    const msg = "setup-error: " + (e as Error).message;
    window.__exportStatus = msg;
    const el = document.getElementById("export-status");
    if (el) el.textContent = msg;
    console.error(e);
  }
}

void setup();
