import { demuxMp4, SourceCoordinator, type MediaByteSource } from "@palmier/engine";
import { fitTransform, defaultCrop, type Timeline, type Clip } from "@palmier/core";

declare global {
  interface Window {
    __layerCount: (frame: number) => Promise<number>;
    __coordinatorReady: boolean;
  }
}

window.__coordinatorReady = false;

const CLIP_URL = "/test/fixtures/clip.mp4";
const FPS = 30;
const W = 320;
const H = 240;

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const resp = await fetch(CLIP_URL);
    if (!resp.ok) throw new Error(`fetch ${CLIP_URL}: ${resp.status}`);
    const fileBytes = await resp.arrayBuffer();
    const demux = await demuxMp4(new Blob([fileBytes]));
    if (!demux.video) throw new Error("no video track");

    const samples = demux.video.samples;
    const lastSample = samples[samples.length - 1]!;
    const durationUs = lastSample.cts + Math.round((lastSample.durationTicks / demux.video.timescale) * 1_000_000);
    const durationFrames = Math.max(2, Math.round(durationUs / 1_000_000 * FPS));

    const natSize = { width: demux.video.codedWidth, height: demux.video.codedHeight };
    const canvasSize = { width: W, height: H };

    // bottom track: full clip, identity transform
    const bottomTransform = fitTransform(natSize, canvasSize);
    const bottomClip: Clip = {
      id: "clip-bottom",
      mediaRef: "clip.mp4",
      mediaType: "video",
      sourceClipType: "video",
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
      transform: bottomTransform,
      crop: defaultCrop(),
    };

    // top track: only first half of frames, scaled to half-size + offset so both are visible
    const halfDuration = Math.max(1, Math.floor(durationFrames / 2));
    const topTransform = { ...fitTransform(natSize, canvasSize), width: 0.4, height: 0.4, centerX: 0.2, centerY: 0.2 };
    const topClip: Clip = {
      id: "clip-top",
      mediaRef: "clip.mp4",
      mediaType: "video",
      sourceClipType: "video",
      startFrame: 0,
      durationFrames: halfDuration,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear",
      fadeOutInterpolation: "linear",
      opacity: 0.8,
      transform: topTransform,
      crop: defaultCrop(),
    };

    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-bottom", type: "video", muted: false, hidden: false, syncLocked: false, clips: [bottomClip] },
        { id: "track-top", type: "video", muted: false, hidden: false, syncLocked: false, clips: [topClip] },
      ],
    };

    const source: MediaByteSource = {
      open(_ref: string): Promise<Blob> {
        return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
      },
    };

    const coord = await SourceCoordinator.create(timeline, source);

    window.__layerCount = async (frame: number) => {
      const { layers, cleanup } = await coord.layersForScrub(frame);
      const count = layers.length;
      cleanup();
      return count;
    };

    window.__coordinatorReady = true;
    status.textContent = `ok — ${durationFrames} frames, half=${halfDuration}`;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
