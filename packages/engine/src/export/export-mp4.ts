import { timelineTotalFrames, type Timeline } from "@palmier/core";
import { SourceCoordinator } from "../compositor/source-coordinator.js";
import type { MediaByteSource } from "../media/media-source.js";
import { FrameRenderer } from "../render/webgpu-renderer.js";
import { AudioMixer } from "../audio/audio-mixer.js";
import type { ExportSink } from "./export-sink.js";
import { WebCodecsMp4Sink } from "./webcodecs-sink.js";

export interface ExportOptions {
  bitrate?: number;
}

export async function runExport(timeline: Timeline, media: MediaByteSource, sink: ExportSink): Promise<Blob | undefined> {
  const { width, height, fps } = timeline;
  const totalFrames = timelineTotalFrames(timeline);

  const offscreen = new OffscreenCanvas(width, height);
  const renderer = await FrameRenderer.create(offscreen);
  const coord = await SourceCoordinator.create(timeline, media);
  const mixer = await AudioMixer.create(timeline, media);

  await sink.configure({
    width,
    height,
    fps,
    audio: mixer ? { sampleRate: mixer.sampleRate, channels: mixer.channels } : undefined,
  });

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      const { layers, cleanup } = await coord.layersForScrub(frame);
      try {
        await renderer.composite(layers, { width, height });
      } finally {
        cleanup();
      }

      const timestamp = Math.round(frame * 1e6 / fps);
      const duration = Math.round(1e6 / fps);
      const vf = new VideoFrame(offscreen, { timestamp, duration });

      try {
        await sink.ready();
        sink.pushVideoFrame(vf, { keyFrame: frame % fps === 0 });
      } finally {
        vf.close();
      }
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
          sink.pushAudioData(data);
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
