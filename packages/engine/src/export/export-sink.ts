export interface ExportSink {
  configure(opts: { width: number; height: number; fps: number; audio?: { sampleRate: number; channels: number } }): Promise<void>;
  ready(): Promise<void>;
  pushVideoFrame(frame: VideoFrame, opts: { keyFrame: boolean }): void | Promise<void>;
  pushAudioData(data: AudioData): void | Promise<void>;
  finalize(): Promise<Blob | undefined>;
}
