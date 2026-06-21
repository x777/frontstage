import {
  defaultCrop, defaultTransform,
  type Timeline, type Clip,
} from "@palmier/core";
import { PlaybackEngine, type MediaByteSource } from "@palmier/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __audioMixReady: boolean;
    __audioCurrentTime: (() => number) | undefined;
    __getLastPeak: () => number;
    __getMixFed: () => number;
  }
}

window.__engine = undefined;
window.__audioMixReady = false;
window.__audioCurrentTime = undefined;

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

    // Two audio clips referencing the same media, overlapping in time (full-length, both at volume 1.0)
    const durationFrames = Math.max(1, Math.round(FPS * 2)); // 2 seconds = 60 frames

    const makeAudioClip = (id: string, vol: number): Clip => ({
      id,
      mediaRef: "clip",
      mediaType: "audio",
      sourceClipType: "audio",
      startFrame: 0,
      durationFrames,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: vol,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear",
      fadeOutInterpolation: "linear",
      opacity: 1,
      transform: defaultTransform(),
      crop: defaultCrop(),
    });

    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track1", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [makeAudioClip("a1", 1.0)] },
        { id: "track2", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [makeAudioClip("a2", 1.0)] },
      ],
    };

    const source: MediaByteSource = {
      open(_ref: string): Promise<Blob> {
        return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
      },
    };

    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const engine = await PlaybackEngine.create(canvas);
    await engine.load(timeline, source);

    window.__engine = engine;
    window.__audioCurrentTime = engine.__audioCurrentTime;
    window.__getLastPeak = () => engine.__audioMixer?.__lastPeak ?? 0;
    window.__getMixFed = () => engine.__audioMixer?.__mixFed ?? 0;
    window.__audioMixReady = true;
    status.textContent = "ok";
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
