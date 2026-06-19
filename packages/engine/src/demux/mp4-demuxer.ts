import MP4Box, { type MP4ArrayBuffer } from "mp4box";

export interface DemuxedSample {
  cts: number; // µs
  dts: number; // µs
  durationTicks: number;
  isSync: boolean;
  byteOffset: number;
  size: number;
}

export interface DemuxedTrack {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  timescale: number;
  samples: DemuxedSample[];
}

export interface DemuxedAudioTrack {
  codec: string;
  sampleRate: number;
  channels: number;
  timescale: number;
  samples: DemuxedSample[];
}

export interface DemuxResult {
  video?: DemuxedTrack;
  audio?: DemuxedAudioTrack;
}

const toMicros = (ts: number, timescale: number): number => Math.round((ts / timescale) * 1_000_000);

export async function demuxMp4(blob: Blob): Promise<DemuxResult> {
  const file = MP4Box.createFile();
  const result: DemuxResult = {};
  const videoSamples: DemuxedSample[] = [];
  const audioSamples: DemuxedSample[] = [];
  let videoTimescale = 1;
  let audioTimescale = 1;

  return new Promise<DemuxResult>((resolve, reject) => {
    file.onError = (e: string) => reject(new Error(`mp4 demux failed: ${e}`));

    file.onReady = (info) => {
      const v = info.videoTracks?.[0];
      const a = info.audioTracks?.[0];
      if (v) {
        videoTimescale = v.timescale;
        result.video = {
          codec: v.codec,
          codedWidth: v.video.width,
          codedHeight: v.video.height,
          timescale: v.timescale,
          samples: videoSamples,
        };
        file.setExtractionOptions(v.id, "video", { nbSamples: Number.MAX_SAFE_INTEGER });
      }
      if (a) {
        audioTimescale = a.timescale;
        result.audio = {
          codec: a.codec,
          sampleRate: a.audio.sample_rate,
          channels: a.audio.channel_count,
          timescale: a.timescale,
          samples: audioSamples,
        };
        file.setExtractionOptions(a.id, "audio", { nbSamples: Number.MAX_SAFE_INTEGER });
      }
      file.start();
    };

    file.onSamples = (_id, user, samples) => {
      const bucket = user === "video" ? videoSamples : audioSamples;
      const timescale = user === "video" ? videoTimescale : audioTimescale;
      for (const s of samples) {
        bucket.push({
          cts: toMicros(s.cts, timescale),
          dts: toMicros(s.dts, timescale),
          durationTicks: s.duration,
          isSync: s.is_sync,
          byteOffset: s.offset,
          size: s.size,
        });
      }
    };

    blob.arrayBuffer().then((ab) => {
      const buf = ab as MP4ArrayBuffer;
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
      // onReady → setExtractionOptions → start → onSamples fire synchronously within flush for an in-memory file.
      resolve(result);
    }, reject);
  });
}
