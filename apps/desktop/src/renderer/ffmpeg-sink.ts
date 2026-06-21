import type { ExportSink } from "@palmier/engine";

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

  async pushVideoFrame(frame: VideoFrame, _opts?: { keyFrame: boolean }): Promise<void> {
    const rgba = new Uint8Array(this.width * this.height * 4);
    await frame.copyTo(rgba, { format: "RGBA" });
    this.bridge.videoFrame(rgba);
  }

  async pushAudioData(data: AudioData): Promise<void> {
    const f32 = new Float32Array(data.numberOfFrames * data.numberOfChannels);
    await data.copyTo(f32, { planeIndex: 0, format: "f32" });
    this.bridge.audioData(new Uint8Array(f32.buffer));
  }

  async finalize(): Promise<undefined> {
    await this.bridge.finish();
    return undefined;
  }
}
