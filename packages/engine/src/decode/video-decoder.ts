import type { DemuxedTrack } from "../demux/mp4-demuxer.js";

export function buildVideoChunks(track: DemuxedTrack, fileBytes: ArrayBuffer): EncodedVideoChunk[] {
  const view = new Uint8Array(fileBytes);
  return track.samples.map((s) =>
    new EncodedVideoChunk({
      type: s.isSync ? "key" : "delta",
      timestamp: s.cts,
      data: view.subarray(s.byteOffset, s.byteOffset + s.size),
    }),
  );
}

export class VideoDecodeManager {
  private open = 0;
  private constructor(
    private decoder: VideoDecoder,
    private track: DemuxedTrack,
    private chunks: EncodedVideoChunk[],
  ) {}

  static async create(track: DemuxedTrack, chunks: EncodedVideoChunk[]): Promise<VideoDecodeManager> {
    const mgr = new VideoDecodeManager(undefined as unknown as VideoDecoder, track, chunks);
    const config: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.codedWidth,
      codedHeight: track.codedHeight,
      ...(track.description ? { description: track.description } : {}),
    };
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`EngineUnsupported: codec ${track.codec}`);
    const decoder = new VideoDecoder({ output: () => {}, error: (e) => { throw e; } });
    decoder.configure(config);
    (mgr as unknown as { decoder: VideoDecoder }).decoder = decoder;
    return mgr;
  }

  openFrameCount(): number { return this.open; }

  async frameAtMicros(targetUs: number): Promise<VideoFrame> {
    let keyIdx = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i]!.type === "key" && this.chunks[i]!.timestamp <= targetUs) keyIdx = i;
    }
    const collected: VideoFrame[] = [];
    const config: VideoDecoderConfig = {
      codec: this.track.codec,
      codedWidth: this.track.codedWidth,
      codedHeight: this.track.codedHeight,
      ...(this.track.description ? { description: this.track.description } : {}),
    };
    const decoder = new VideoDecoder({
      output: (f) => { this.open++; collected.push(f); },
      error: (e) => { throw e; },
    });
    decoder.configure(config);
    for (let i = keyIdx; i < this.chunks.length; i++) {
      const c = this.chunks[i]!;
      decoder.decode(c);
      if (c.timestamp >= targetUs) break;
    }
    await decoder.flush();
    decoder.close();
    let best: VideoFrame | undefined;
    for (const f of collected) {
      if (f.timestamp <= targetUs && (!best || f.timestamp > best.timestamp)) {
        if (best) { best.close(); this.open--; }
        best = f;
      } else {
        f.close(); this.open--;
      }
    }
    if (!best && collected.length > 0) { best = collected[collected.length - 1]; }
    if (!best) throw new Error("no frame decoded");
    // Wrap the returned frame so caller's close() decrements open count
    const mgr = this;
    return new Proxy(best, {
      get(target, prop) {
        if (prop === "close") {
          return () => { target.close(); mgr.open--; };
        }
        const val = (target as unknown as Record<string, unknown>)[prop as string];
        return typeof val === "function" ? (val as Function).bind(target) : val;
      },
    });
  }

  dispose(): void {
    if (this.decoder.state !== "closed") this.decoder.close();
  }
}
