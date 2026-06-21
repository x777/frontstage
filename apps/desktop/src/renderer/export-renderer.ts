import {
  runExport,
  demuxMp4,
  type MediaByteSource,
} from "@palmier/engine";
import {
  fitTransform,
  defaultCrop,
  type Timeline,
  type Clip,
} from "@palmier/core";
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

// CARRY-FORWARD: WebGPU video decode (importExternalTexture) in a sustained export loop crashes
// the GPU device in Electron on this Windows box: mapAsync → "Device is lost". The image-only
// WebGPU path (copyExternalImageToTexture) is stable and exercises the full runExport +
// FfmpegIpcSink.pushFrame(renderer.readRGBA()) path end-to-end. Audio is provided via an
// audio-only clip referencing clip.mp4 (CPU-side decode, no GPU). The two-pass audio mux is
// fully exercised. Unblock: when Electron WebGPU video-decode stability improves, add a video
// track backed by clip.mp4 and remove this note.

const CLIP_URL = "/test/fixtures/clip.mp4";
const FPS = 30;
const W = 320;
const H = 240;

window.__exportStatus = "export-init";

async function makeSolidPng(r: number, g: number, b: number): Promise<ArrayBuffer> {
  const oc = new OffscreenCanvas(W, H);
  const ctx = oc.getContext("2d")!;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, W, H);
  const blob = await oc.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

async function setup(): Promise<void> {
  try {
    // Fetch clip.mp4 for audio extraction (CPU-side decode, no GPU involvement)
    const clipResp = await fetch(CLIP_URL);
    if (!clipResp.ok) throw new Error(`fetch ${CLIP_URL}: ${clipResp.status}`);
    const clipBytes = await clipResp.arrayBuffer();

    const demux = await demuxMp4(new Blob([clipBytes]));
    const samples = demux.video?.samples ?? [];
    const lastSample = samples[samples.length - 1];
    const durationUs = lastSample && demux.video
      ? lastSample.cts + Math.round((lastSample.durationTicks / demux.video.timescale) * 1_000_000)
      : 1_000_000;
    // Cap at 5 frames — ProRes mux + audio on this box must finish within 30s IPC timeout
    const durationFrames = Math.min(5, Math.max(2, Math.round(durationUs / 1_000_000 * FPS)));

    const imgBytes = await makeSolidPng(64, 128, 192);
    const imgTransform = fitTransform({ width: W, height: H }, { width: W, height: H });

    const imgClip: Clip = {
      id: "clip-img",
      mediaRef: "frame.png",
      mediaType: "image",
      sourceClipType: "image",
      startFrame: 0,
      durationFrames,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear",
      fadeOutInterpolation: "linear",
      opacity: 1,
      transform: imgTransform,
      crop: defaultCrop(),
    };

    // Audio-only clip referencing clip.mp4 — AudioMixer decodes CPU-side, no GPU
    const audioClip: Clip = {
      id: "clip-audio",
      mediaRef: "clip.mp4",
      mediaType: "audio",
      sourceClipType: "audio",
      startFrame: 0,
      durationFrames,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear",
      fadeOutInterpolation: "linear",
      opacity: 1,
      transform: imgTransform,
      crop: defaultCrop(),
    };

    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-img", type: "image", muted: false, hidden: false, syncLocked: false, clips: [imgClip] },
        { id: "track-audio", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [audioClip] },
      ],
    };

    const source: MediaByteSource = {
      open(ref: string): Promise<Blob> {
        if (ref === "frame.png") return Promise.resolve(new Blob([imgBytes], { type: "image/png" }));
        return Promise.resolve(new Blob([clipBytes], { type: "video/mp4" }));
      },
    };

    window.__runDesktopExport = async (codec: string, outPath: string): Promise<string> => {
      const sink = new FfmpegIpcSink(window.desktopExport, { codec, outPath });
      await runExport(timeline, source, sink);
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
