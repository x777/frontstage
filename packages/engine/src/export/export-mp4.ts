import { timelineTotalFrames, fitShortestSide, type Timeline } from "@palmier/core";
import { SourceCoordinator } from "../compositor/source-coordinator.js";
import type { MediaByteSource } from "../media/media-source.js";
import { FrameRenderer } from "../render/webgpu-renderer.js";
import { AudioMixer } from "../audio/audio-mixer.js";
import type { ExportSink } from "./export-sink.js";
import { WebCodecsMp4Sink } from "./webcodecs-sink.js";

export interface ExportOptions {
  bitrate?: number;
}

// A sub-range/downscaled render (M14C T3's generate_audio span-render): omitted fields fall back
// to a full, full-resolution, audio-included export — the existing runExport behavior.
export interface SpanRenderOptions {
  startFrame?: number;
  frameCount?: number;
  includeAudio?: boolean;
  width?: number;
  height?: number;
}

export async function runExport(
  timeline: Timeline,
  media: MediaByteSource,
  sink: ExportSink,
  onProgress?: (completed: number, total: number) => void,
  renderOpts?: SpanRenderOptions,
): Promise<Blob | undefined> {
  const width = renderOpts?.width ?? timeline.width;
  const height = renderOpts?.height ?? timeline.height;
  const fps = timeline.fps;
  const totalFrames = timelineTotalFrames(timeline);
  const startFrame = renderOpts?.startFrame ?? 0;
  const frameCount = renderOpts?.frameCount ?? Math.max(0, totalFrames - startFrame);
  const includeAudio = renderOpts?.includeAudio ?? true;

  const offscreen = new OffscreenCanvas(width, height);
  const renderer = await FrameRenderer.create(offscreen);
  const coord = await SourceCoordinator.create(timeline, media);
  const mixer = includeAudio ? await AudioMixer.create(timeline, media) : undefined;

  await sink.configure({
    width,
    height,
    fps,
    audio: mixer ? { sampleRate: mixer.sampleRate, channels: mixer.channels } : undefined,
  });

  try {
    for (let i = 0; i < frameCount; i++) {
      const frame = startFrame + i;
      const { layers, cleanup } = await coord.layersForScrub(frame);
      try {
        await renderer.composite(layers, { width, height });
      } finally {
        cleanup();
      }

      await sink.ready();
      await sink.pushFrame({
        offscreen,
        renderer,
        timestampUs: Math.round(i * 1e6 / fps),
        durationUs: Math.round(1e6 / fps),
        keyFrame: i % fps === 0,
      });
      onProgress?.(i + 1, frameCount);
    }

    if (mixer) {
      let win: Float32Array | undefined;
      let t = 0;
      while ((win = mixer.mixNext(timeline, fps))) {
        const numberOfFrames = win.length / mixer.channels;
        const data = new AudioData({
          format: "f32",
          sampleRate: mixer.sampleRate,
          numberOfFrames,
          numberOfChannels: mixer.channels,
          timestamp: Math.round(t * 1e6 / mixer.sampleRate),
          data: win.buffer as ArrayBuffer,
        });
        try {
          await sink.ready();
          await sink.pushAudioData(data);
        } finally {
          data.close();
        }
        t += numberOfFrames;
      }
    }

    return await sink.finalize();
  } finally {
    renderer.dispose();
    coord.dispose();
    mixer?.dispose();
  }
}

export async function exportTimelineToMp4(
  timeline: Timeline,
  media: MediaByteSource,
  opts?: ExportOptions,
): Promise<Blob> {
  const blob = await runExport(timeline, media, new WebCodecsMp4Sink(opts));
  return blob!;
}

// Headless span render for generate_audio's video-to-audio source (M14C T3, the M10 deferral):
// silent (no audio track — Swift's TimelineRenderer.render(includeAudio: false)), shrunk to
// shortSide, reusing the SAME composite/encode pipeline the real export gateways drive — just
// with no save dialog and no file write. Both hosts wire ToolContext.generation.renderSpanToMp4
// to this directly.
export async function renderSpanToMp4(
  timeline: Timeline,
  media: MediaByteSource,
  opts: { startFrame: number; frameCount: number; shortSide?: number },
): Promise<Uint8Array> {
  const { width, height } = opts.shortSide != null
    ? fitShortestSide(timeline.width, timeline.height, opts.shortSide)
    : { width: timeline.width, height: timeline.height };

  const blob = await runExport(timeline, media, new WebCodecsMp4Sink(), undefined, {
    startFrame: opts.startFrame,
    frameCount: opts.frameCount,
    includeAudio: false,
    width,
    height,
  });
  if (!blob) throw new Error("Span render produced no output");
  return new Uint8Array(await blob.arrayBuffer());
}
