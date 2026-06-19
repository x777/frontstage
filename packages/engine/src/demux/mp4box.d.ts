declare module "mp4box" {
  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export interface MP4VideoTrack {
    id: number;
    codec: string;
    timescale: number;
    video: { width: number; height: number };
  }

  export interface MP4AudioTrack {
    id: number;
    codec: string;
    timescale: number;
    audio: { sample_rate: number; channel_count: number };
  }

  export interface MP4Info {
    videoTracks: MP4VideoTrack[];
    audioTracks: MP4AudioTrack[];
  }

  export interface MP4Sample {
    cts: number;
    dts: number;
    duration: number;
    is_sync: boolean;
    offset: number;
    size: number;
    timescale: number;
  }

  export interface MP4File {
    onReady: ((info: MP4Info) => void) | null;
    onError: ((e: string) => void) | null;
    onSamples: ((id: number, user: string, samples: MP4Sample[]) => void) | null;
    setExtractionOptions(id: number, user: string, options: { nbSamples: number }): void;
    appendBuffer(buffer: MP4ArrayBuffer): number;
    start(): void;
    flush(): void;
  }

  const MP4Box: { createFile(): MP4File };
  export default MP4Box;
}
