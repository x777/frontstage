// File System Access API's async directory iteration isn't in TS's lib.dom.d.ts yet — needed by
// web-skills.ts's SkillStorage.list() to enumerate the OPFS palmier-skills/ subfolders.
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
}

// Ambient declarations for @palmier/engine transitive dependencies.
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
  export interface AvcCBox {
    write(stream: DataStreamInstance): void;
  }
  export interface DecoderSpecificInfo {
    tag: number;
    data: Uint8Array;
  }
  export interface DecoderConfigDescriptor {
    tag: number;
    descs: DecoderSpecificInfo[];
  }
  export interface EsDescriptor {
    tag: number;
    descs: DecoderConfigDescriptor[];
  }
  export interface EsdsBox {
    esd?: EsDescriptor;
  }
  export interface SampleEntry {
    avcC?: AvcCBox;
    esds?: EsdsBox;
  }
  export interface MP4Trak {
    mdia: {
      minf: {
        stbl: {
          stsd: {
            entries: SampleEntry[];
          };
        };
      };
    };
  }
  export interface DataStreamInstance {
    buffer: ArrayBuffer;
  }
  export interface MP4File {
    onReady: ((info: MP4Info) => void) | null;
    onError: ((e: string) => void) | null;
    onSamples: ((id: number, user: string, samples: MP4Sample[]) => void) | null;
    setExtractionOptions(id: number, user: string, options: { nbSamples: number }): void;
    appendBuffer(buffer: MP4ArrayBuffer): number;
    start(): void;
    flush(): void;
    getTrackById(id: number): MP4Trak | null;
  }
  export interface DataStreamConstructor {
    new (buffer?: ArrayBuffer, byteOffset?: number, endianness?: boolean): DataStreamInstance;
    BIG_ENDIAN: boolean;
    LITTLE_ENDIAN: boolean;
  }
  const MP4Box: {
    createFile(): MP4File;
    DataStream: DataStreamConstructor;
  };
  export default MP4Box;
}
