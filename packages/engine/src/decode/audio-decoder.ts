import type { DemuxedAudioTrack } from "../demux/mp4-demuxer.js";

export interface PcmChunk {
  timestampUs: number;
  sampleRate: number;
  channels: number;
  data: Float32Array;
}

export function buildAudioChunks(track: DemuxedAudioTrack, fileBytes: ArrayBuffer): EncodedAudioChunk[] {
  const view = new Uint8Array(fileBytes);
  return track.samples.map((s) =>
    new EncodedAudioChunk({
      type: "key",
      timestamp: s.cts,
      data: view.subarray(s.byteOffset, s.byteOffset + s.size),
    }),
  );
}

export class AudioDecodeManager {
  private constructor(private track: DemuxedAudioTrack, private chunks: EncodedAudioChunk[]) {}

  static async create(track: DemuxedAudioTrack, chunks: EncodedAudioChunk[]): Promise<AudioDecodeManager> {
    const config: AudioDecoderConfig = {
      codec: track.codec,
      sampleRate: track.sampleRate,
      numberOfChannels: track.channels,
      ...(track.description ? { description: track.description } : {}),
    };
    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`EngineUnsupported: audio codec ${track.codec}`);
    return new AudioDecodeManager(track, chunks);
  }

  private buildConfig(): AudioDecoderConfig {
    return {
      codec: this.track.codec,
      sampleRate: this.track.sampleRate,
      numberOfChannels: this.track.channels,
      ...(this.track.description ? { description: this.track.description } : {}),
    };
  }

  async decodeAll(onPcm: (pcm: PcmChunk) => void): Promise<void> {
    const config = this.buildConfig();
    let decodeError: Error | null = null;
    const decoder = new AudioDecoder({
      output: (audioData) => {
        const channels = audioData.numberOfChannels;
        const frames = audioData.numberOfFrames;
        const interleaved = new Float32Array(frames * channels);
        const plane = new Float32Array(frames);
        for (let ch = 0; ch < channels; ch++) {
          audioData.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
          for (let i = 0; i < frames; i++) interleaved[i * channels + ch] = plane[i]!;
        }
        onPcm({
          timestampUs: audioData.timestamp,
          sampleRate: audioData.sampleRate,
          channels,
          data: interleaved,
        });
        audioData.close();
      },
      error: (e) => { decodeError = e; },
    });
    decoder.configure(config);
    for (const c of this.chunks) decoder.decode(c);
    try {
      await decoder.flush();
    } catch {
      // flush rejects when the decoder errored; decodeError is already captured above
    }
    decoder.close();
    if (decodeError) throw decodeError;
  }

  dispose(): void { /* decodeAll owns its decoder */ }
}
