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
    __measurePeak: (volume: number) => Promise<number>;
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

    const source: MediaByteSource = {
      open(_ref: string): Promise<Blob> {
        return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
      },
    };

    const canvas = document.getElementById("c") as HTMLCanvasElement;

    // Load the two-clip (overlapping) timeline for the mix test
    const makeTwoClipTimeline = (vol: number): Timeline => ({
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track1", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [makeAudioClip("a1", vol)] },
        { id: "track2", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [makeAudioClip("a2", vol)] },
      ],
    });

    const engine = await PlaybackEngine.create(canvas);
    await engine.load(makeTwoClipTimeline(1.0), source);

    window.__engine = engine;
    window.__audioCurrentTime = engine.__audioCurrentTime;
    window.__getLastPeak = () => engine.__audioMixer?.__lastPeak ?? 0;
    window.__getMixFed = () => engine.__audioMixer?.__mixFed ?? 0;

    // Measure peak abs sample for a single-clip timeline at the given volume.
    // Loads a fresh single-clip timeline, plays ~500ms, returns the peak.
    window.__measurePeak = async (volume: number): Promise<number> => {
      const singleClipTimeline: Timeline = {
        fps: FPS,
        width: W,
        height: H,
        settingsConfigured: true,
        tracks: [
          { id: "track1", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [makeAudioClip("a1", volume)] },
        ],
      };
      await engine.load(singleClipTimeline, source);
      engine.seek(0, "exact");
      await new Promise((res) => setTimeout(res, 50));
      engine.play();
      await new Promise((res) => setTimeout(res, 500));
      // Capture peak before pause(), which resets __lastPeak
      const peak = engine.__audioMixer?.__lastPeak ?? 0;
      engine.pause();
      return peak;
    };

    window.__audioMixReady = true;
    status.textContent = "ok";
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
