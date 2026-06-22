import {
  fitTransform, defaultCrop,
  type Timeline, type Clip,
} from "@palmier/core";
import { demuxMp4, PlaybackEngine, type MediaByteSource } from "@palmier/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __setTimelineReady: boolean;
    __layerCountAfterSetTimeline: () => Promise<number>;
    __layerCountAfterRevert: () => Promise<number>;
    __openFrameCountAfterRevert: () => number;
  }
}

window.__engine = undefined;
window.__setTimelineReady = false;

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

    const source: MediaByteSource = {
      open(_ref: string): Promise<Blob> {
        return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
      },
    };

    const makeClip = (id: string, transform?: ReturnType<typeof fitTransform>): Clip => ({
      id,
      mediaRef: "clip.mp4",
      mediaType: "video" as const,
      sourceClipType: "video" as const,
      startFrame: 0,
      durationFrames,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear" as const,
      fadeOutInterpolation: "linear" as const,
      opacity: 1,
      transform: transform ?? fitTransform(natSize, canvasSize),
      crop: defaultCrop(),
    });

    // 1-clip timeline: single video clip on track 0
    const oneClipTimeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-0", type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("clip-a")] },
      ],
    };

    // 2-clip timeline: original clip on track 0, second clip on track 1 (right half)
    const rightHalfTransform = { ...fitTransform(natSize, canvasSize), centerX: 0.75, width: 0.5 };
    const twoClipTimeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-0", type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("clip-a")] },
        { id: "track-1", type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("clip-b", rightHalfTransform)] },
      ],
    };

    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const engine = await PlaybackEngine.create(canvas);
    await engine.load(oneClipTimeline, source);

    const seekFrame = Math.max(0, Math.floor(durationFrames / 2));

    window.__engine = engine;

    window.__layerCountAfterSetTimeline = async (): Promise<number> => {
      await engine.setTimeline(twoClipTimeline);
      await engine.seek(seekFrame, "exact");
      return engine.__lastLayerCount;
    };

    window.__layerCountAfterRevert = async (): Promise<number> => {
      await engine.setTimeline(oneClipTimeline);
      await engine.seek(seekFrame, "exact");
      return engine.__lastLayerCount;
    };

    window.__openFrameCountAfterRevert = (): number => engine.openFrameCount();

    window.__setTimelineReady = true;
    status.textContent = `ok — ${durationFrames} frames`;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
