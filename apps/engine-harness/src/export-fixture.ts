import {
  fitTransform, defaultCrop,
  timelineTotalFrames,
  type Timeline, type Clip,
} from "@palmier/core";
import { demuxMp4, runExport, WebCodecsMp4Sink, type MediaByteSource } from "@palmier/engine";

declare global {
  interface Window {
    __exportAndDemux: (() => Promise<{
      hasVideo: boolean;
      width: number | undefined;
      height: number | undefined;
      videoSampleCount: number | undefined;
      timelineWidth: number;
      timelineHeight: number;
      totalFrames: number;
      hasAudio: boolean;
      audioSampleRate: number | undefined;
      videoDurationUs: number | undefined;
      audioDurationUs: number | undefined;
      progressCalls: number;
      progressLast: [number, number];
      progressMonotonic: boolean;
    }>) | undefined;
    __status: string;
  }
}

window.__exportAndDemux = undefined;
window.__status = "init";

const CLIP_URL = "/test/fixtures/clip.mp4";
const FPS = 30;
const W = 320;
const H = 240;

async function makeGreenPng(): Promise<ArrayBuffer> {
  const oc = new OffscreenCanvas(W, H);
  const ctx = oc.getContext("2d")!;
  ctx.fillStyle = "rgb(0,255,0)";
  ctx.fillRect(0, 0, W, H);
  const blob = await oc.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const [videoResp, greenPngBytes] = await Promise.all([
      fetch(CLIP_URL),
      makeGreenPng(),
    ]);
    if (!videoResp.ok) throw new Error(`fetch ${CLIP_URL}: ${videoResp.status}`);
    const fileBytes = await videoResp.arrayBuffer();
    const demux = await demuxMp4(new Blob([fileBytes]));
    if (!demux.video) throw new Error("no video track");

    const samples = demux.video.samples;
    const lastSample = samples[samples.length - 1]!;
    const durationUs = lastSample.cts + Math.round((lastSample.durationTicks / demux.video.timescale) * 1_000_000);
    // Keep short: cap at 25 frames for fast export
    const durationFrames = Math.min(25, Math.max(2, Math.round(durationUs / 1_000_000 * FPS)));

    const natSize = { width: demux.video.codedWidth, height: demux.video.codedHeight };
    const canvasSize = { width: W, height: H };

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

    const topTransform = { ...fitTransform({ width: W, height: H }, canvasSize), width: 0.5, height: 0.5, centerX: 0.25, centerY: 0.25 };
    const topClip: Clip = {
      id: "clip-top",
      mediaRef: "green.png",
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
      open(ref: string): Promise<Blob> {
        if (ref === "green.png") return Promise.resolve(new Blob([greenPngBytes], { type: "image/png" }));
        return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
      },
    };

    const totalFrames = timelineTotalFrames(timeline);

    window.__exportAndDemux = async () => {
      const calls: Array<[number, number]> = [];
      const onProgress = (c: number, t: number) => calls.push([c, t]);
      const blob = await runExport(timeline, source, new WebCodecsMp4Sink(), onProgress);
      const demuxResult = await demuxMp4(blob!);

      const videoSamples = demuxResult.video?.samples;
      const audioSamples = demuxResult.audio?.samples;

      const lastVideoSample = videoSamples?.at(-1);
      const videoDurationUs = lastVideoSample
        ? lastVideoSample.cts + Math.round((lastVideoSample.durationTicks / demuxResult.video!.timescale) * 1_000_000)
        : undefined;

      const lastAudioSample = audioSamples?.at(-1);
      const audioDurationUs = lastAudioSample
        ? lastAudioSample.cts + Math.round((lastAudioSample.durationTicks / demuxResult.audio!.timescale) * 1_000_000)
        : undefined;

      const progressMonotonic = calls.length > 0 &&
        calls.every(([c], i) => i === 0 ? c === 1 : c === calls[i - 1]![0] + 1) &&
        calls.every(([, t]) => t === calls[calls.length - 1]![1]);

      return {
        hasVideo: !!demuxResult.video,
        width: demuxResult.video?.codedWidth,
        height: demuxResult.video?.codedHeight,
        videoSampleCount: demuxResult.video?.samples.length,
        timelineWidth: W,
        timelineHeight: H,
        totalFrames,
        hasAudio: !!demuxResult.audio,
        audioSampleRate: demuxResult.audio?.sampleRate,
        videoDurationUs,
        audioDurationUs,
        progressCalls: calls.length,
        progressLast: calls[calls.length - 1] ?? [0, 0],
        progressMonotonic,
      };
    };

    window.__status = "ok";
    status.textContent = "ok";
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    window.__status = msg;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
