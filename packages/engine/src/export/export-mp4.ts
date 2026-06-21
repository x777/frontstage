import { timelineTotalFrames, type Timeline } from "@palmier/core";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { SourceCoordinator } from "../compositor/source-coordinator.js";
import type { MediaByteSource } from "../media/media-source.js";
import { FrameRenderer } from "../render/webgpu-renderer.js";

export interface ExportOptions {
  bitrate?: number;
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

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

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

      // Try constructing a VideoFrame directly from the OffscreenCanvas.
      // If the composited result isn't captured (black frame), fall back to
      // reading the RGBA readback texture.
      let vf: VideoFrame;
      try {
        vf = new VideoFrame(offscreen, { timestamp, duration });
      } catch {
        // OffscreenCanvas path failed; use GPU readback
        const rgba = await renderer.readFrame();
        vf = new VideoFrame(rgba, {
          format: "RGBA",
          codedWidth: width,
          codedHeight: height,
          timestamp,
          duration,
        });
      }

      encoder.encode(vf, { keyFrame: frame % fps === 0 });
      vf.close();
    }

    await encoder.flush();
    if (encoderError) throw encoderError;

    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    return blob;
  } finally {
    renderer.dispose();
    coord.dispose();
  }
}
