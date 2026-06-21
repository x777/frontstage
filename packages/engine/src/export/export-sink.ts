import type { FrameRenderer } from "../render/webgpu-renderer.js";

export interface PushFrameSource {
  offscreen: OffscreenCanvas;
  renderer: FrameRenderer;
  timestampUs: number;
  durationUs: number;
  keyFrame: boolean;
}

export interface ExportSink {
  configure(opts: { width: number; height: number; fps: number; audio?: { sampleRate: number; channels: number } }): Promise<void>;
  ready(): Promise<void>;
  pushFrame(source: PushFrameSource): void | Promise<void>;
  pushAudioData(data: AudioData): void | Promise<void>;
  finalize(): Promise<Blob | undefined>;
}
