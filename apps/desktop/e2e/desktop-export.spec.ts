import { _electron as electron, test, expect } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — no types for ffprobe-static
import ffprobeStatic from "ffprobe-static";

const ffprobeBin: string = (ffprobeStatic as any).path ?? ffprobeStatic;

function ffprobe(filePath: string): { streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; duration?: string }> } {
  const result = spawnSync(
    ffprobeBin,
    ["-v", "quiet", "-print_format", "json", "-show_streams", filePath],
    { encoding: "utf-8", timeout: 30_000 },
  );
  if (result.status !== 0) throw new Error(`ffprobe exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function launchAndExport(codec: string, outPath: string): Promise<string> {
  const app = await electron.launch({
    args: [path.join(__dirname, "../src/main/index.cjs")],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, RENDERER_PORT: "5190" },
  });

  try {
    const page = await app.firstWindow();

    // Navigate to export page (separate from spike to avoid WebGPU contention)
    await page.goto(`http://localhost:5190/export.html`);

    // Capture renderer console for debug
    page.on("console", (msg) => console.log("[renderer]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.error("[renderer pageerror]", err.message));

    // Wait for export-renderer setup to complete
    await page.waitForFunction(
      () => {
        const s = (window as any).__exportStatus as string | undefined;
        return typeof s === "string" && s !== "export-init";
      },
      { timeout: 30_000 },
    );

    const status = await page.evaluate(() => (window as any).__exportStatus as string);
    if (status !== "ready") throw new Error(`export-renderer setup failed: ${status}`);

    // Run the export — may take a while for ProRes
    const result = await page.evaluate(
      async ({ codec, outPath }: { codec: string; outPath: string }) => {
        try {
          const fn = (window as any).__runDesktopExport as ((codec: string, outPath: string) => Promise<string>) | undefined;
          if (!fn) return { error: "__runDesktopExport not found" };
          const p = await fn(codec, outPath);
          return { path: p };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
      { codec, outPath },
    );

    if ("error" in result) throw new Error(`export failed: ${result.error}`);
    return result.path;
  } finally {
    await app.close();
  }
}

test("H.264 export produces a valid MP4 with correct dimensions and audio", async () => {
  const outPath = path.join(os.tmpdir(), `desktop-export-h264-${Date.now()}.mp4`);
  try {
    const result = await launchAndExport("libx264", outPath);

    expect(existsSync(result), `output file missing: ${result}`).toBe(true);

    const info = ffprobe(result);
    const videoStream = info.streams.find((s) => s.codec_type === "video");
    expect(videoStream, "no video stream in output").toBeDefined();
    expect(videoStream!.codec_name).toBe("h264");
    expect(videoStream!.width).toBe(320);
    expect(videoStream!.height).toBe(240);

    const durationSec = videoStream!.duration ? parseFloat(videoStream!.duration) : NaN;
    expect(durationSec).toBeGreaterThan(0.05);

    const audioStream = info.streams.find((s) => s.codec_type === "audio");
    expect(audioStream, "no audio stream in output").toBeDefined();
    expect(audioStream!.codec_name).toBe("aac");
  } finally {
    try { rmSync(outPath); } catch { /* ignore */ }
  }
});

test("ProRes export produces a valid MOV with correct dimensions and audio", async () => {
  const outPath = path.join(os.tmpdir(), `desktop-export-prores-${Date.now()}.mov`);
  try {
    const result = await launchAndExport("prores_ks", outPath);

    expect(existsSync(result), `output file missing: ${result}`).toBe(true);

    const info = ffprobe(result);
    const videoStream = info.streams.find((s) => s.codec_type === "video");
    expect(videoStream, "no video stream in output").toBeDefined();
    expect(videoStream!.codec_name).toBe("prores");
    expect(videoStream!.width).toBe(320);
    expect(videoStream!.height).toBe(240);

    const durationSec = videoStream!.duration ? parseFloat(videoStream!.duration) : NaN;
    expect(durationSec).toBeGreaterThan(0.05);

    const audioStream = info.streams.find((s) => s.codec_type === "audio");
    expect(audioStream, "no audio stream in output").toBeDefined();
    expect(audioStream!.codec_name).toBe("aac");
  } finally {
    try { rmSync(outPath); } catch { /* ignore */ }
  }
});
