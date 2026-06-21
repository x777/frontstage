import type { ExportSink, PushFrameSource } from "@palmier/engine";

export interface DesktopExportBridge {
  start(opts: { width: number; height: number; fps: number; audio?: { sampleRate: number; channels: number }; codec: string; outPath: string }): Promise<string>;
  videoFrame(buf: Uint8Array): void;
  audioData(buf: Uint8Array): void;
  finish(): Promise<string>;
}

export interface FfmpegIpcSinkOptions {
  codec: string;
  outPath: string;
}

export class FfmpegIpcSink implements ExportSink {
  private bridge: DesktopExportBridge;
  private codec: string;
  private outPath: string;
  private width = 0;
  private height = 0;

  constructor(bridge: DesktopExportBridge, opts: FfmpegIpcSinkOptions) {
    this.bridge = bridge;
    this.codec = opts.codec;
    this.outPath = opts.outPath;
  }

  async configure(opts: { width: number; height: number; fps: number; audio?: { sampleRate: number; channels: number } }): Promise<void> {
    this.width = opts.width;
    this.height = opts.height;
    await this.bridge.start({ ...opts, codec: this.codec, outPath: this.outPath });
  }

  async ready(): Promise<void> {
    // IPC is async by nature; no encoder queue to drain here
  }

  // Extract RGBA via VideoFrame.copyTo — NOT FrameRenderer.readRGBA() (packages/engine/src/render/webgpu-renderer.ts), which loses the GPU device in a sustained Electron loop.
  async pushFrame(source: PushFrameSource): Promise<void> {
    const rgba = new Uint8Array(this.width * this.height * 4);
    const vf = new VideoFrame(source.offscreen, { timestamp: source.timestampUs });
    try {
      await vf.copyTo(rgba, { format: "RGBA" });
    } finally {
      vf.close();
    }
    this.bridge.videoFrame(rgba);
  }

  async pushAudioData(data: AudioData): Promise<void> {
    const f32 = new Float32Array(data.numberOfFrames * data.numberOfChannels);
    // f32 (interleaved) — all channels in plane 0, no left-channel-only reduction
    await data.copyTo(f32, { planeIndex: 0, format: "f32" });
    this.bridge.audioData(new Uint8Array(f32.buffer));
  }

  async finalize(): Promise<undefined> {
    await this.bridge.finish();
    return undefined;
  }
}
