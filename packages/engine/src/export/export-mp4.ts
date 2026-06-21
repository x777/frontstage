import { timelineTotalFrames, type Timeline } from "@palmier/core";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { SourceCoordinator } from "../compositor/source-coordinator.js";
import type { MediaByteSource } from "../media/media-source.js";
import { FrameRenderer } from "../render/webgpu-renderer.js";
import { AudioMixer } from "../audio/audio-mixer.js";

export interface ExportOptions {
  bitrate?: number;
}

async function drain(encoder: VideoEncoder | AudioEncoder, limit: number): Promise<void> {
  while (encoder.encodeQueueSize > limit) {
    await new Promise<void>((resolve) => {
      const onDequeue = () => resolve();
      try {
        encoder.addEventListener("dequeue", onDequeue, { once: true });
      } catch {
        // dequeue event unavailable — fall back to polling
        const poll = setInterval(() => {
          if (encoder.encodeQueueSize <= limit) { clearInterval(poll); resolve(); }
        }, 1);
        return;
      }
    });
  }
}

export async function exportTimelineToMp4(
  timeline: Timeline,
  media: MediaByteSource,
  opts?: ExportOptions,
): Promise<Blob> {
  const { width, height, fps } = timeline;
  const totalFrames = timelineTotalFrames(timeline);

  const offscreen = new OffscreenCanvas(width, height);
  const renderer = await FrameRenderer.create(offscreen);
  const coord = await SourceCoordinator.create(timeline, media);
  const mixer = await AudioMixer.create(timeline, media);

  const target = new ArrayBufferTarget();
  const muxerOpts: ConstructorParameters<typeof Muxer>[0] = {
    target,
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  };
  if (mixer) {
    muxerOpts.audio = { codec: "aac", sampleRate: mixer.sampleRate, numberOfChannels: mixer.channels };
  }
  const muxer = new Muxer(muxerOpts);

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta!),
    error: (e) => { encoderError = e; },
  });

  const supported = await VideoEncoder.isConfigSupported({
    codec: "avc1.42001f",
    width,
    height,
    bitrate: opts?.bitrate ?? 5_000_000,
    framerate: fps,
  });

  const codec = supported.supported ? "avc1.42001f" : "avc1.42E01F";

  encoder.configure({
    codec,
    width,
    height,
    bitrate: opts?.bitrate ?? 5_000_000,
    framerate: fps,
  });

  let audioEncoder: AudioEncoder | undefined;
  let audioError: Error | null = null;

  if (mixer) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta!),
      error: (e) => { audioError = e; },
    });
    audioEncoder.configure({
      codec: "mp4a.40.2",
      sampleRate: mixer.sampleRate,
      numberOfChannels: mixer.channels,
      bitrate: 128_000,
    });
  }

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      if (encoderError) throw encoderError;

      const { layers, cleanup } = await coord.layersForScrub(frame);
      try {
        await renderer.composite(layers, { width, height });
      } finally {
        cleanup();
      }

      const timestamp = Math.round(frame * 1e6 / fps);
      const duration = Math.round(1e6 / fps);

      const vf = new VideoFrame(offscreen, { timestamp, duration });

      if (encoderError) throw encoderError;
      await drain(encoder, 8);
      if (encoderError) throw encoderError;
      encoder.encode(vf, { keyFrame: frame % fps === 0 });
      vf.close();
    }

    await encoder.flush();
    if (encoderError) throw encoderError;

    if (mixer && audioEncoder) {
      let win: Float32Array | undefined;
      let t = 0;
      while ((win = mixer.mixNext(timeline, fps))) {
        if (audioError) throw audioError;
        const numberOfFrames = win.length / mixer.channels;
        const data = new AudioData({
          format: "f32",
          sampleRate: mixer.sampleRate,
          numberOfFrames,
          numberOfChannels: mixer.channels,
          timestamp: Math.round(t * 1e6 / mixer.sampleRate),
          data: win.buffer as ArrayBuffer,
        });
        if (audioError) throw audioError;
        await drain(audioEncoder, 8);
        if (audioError) throw audioError;
        audioEncoder.encode(data);
        data.close();
        t += numberOfFrames;
      }
      await audioEncoder.flush();
      if (audioError) throw audioError;
    }

    muxer.finalize();
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    return blob;
  } finally {
    try { if (encoder.state !== "closed") encoder.close(); } catch { /* already closed */ }
    try { if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close(); } catch { /* already closed */ }
    renderer.dispose();
    coord.dispose();
    mixer?.dispose();
  }
}
