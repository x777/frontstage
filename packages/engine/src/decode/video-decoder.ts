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
    // Pick best frame: latest frame with timestamp ≤ targetUs; if none, fall back to earliest.
    let best: VideoFrame | undefined;
    let fallback: VideoFrame | undefined;
    for (const f of collected) {
      if (f.timestamp <= targetUs) {
        if (!best || f.timestamp > best.timestamp) {
          if (best) { best.close(); this.open--; }
          best = f;
        } else {
          f.close(); this.open--;
        }
      } else {
        if (!fallback || f.timestamp < fallback.timestamp) {
          if (fallback) { fallback.close(); this.open--; }
          fallback = f;
        } else {
          f.close(); this.open--;
        }
      }
    }
    // Use best if found; otherwise take the earliest frame past targetUs.
    if (!best && fallback) { best = fallback; fallback = undefined; }
    if (fallback) { fallback.close(); this.open--; }
    if (!best) throw new Error("no frame decoded");
    // Clone before decoder.close(): on Chromium/D3D11, decoder.close() may release zero-copy
    // GPU texture backing even while the JS VideoFrame object is still in scope.
    const cloned = best.clone();
    best.close(); this.open--; // close original
    this.open++;               // track clone
    return cloned;
  }

  closeFrame(frame: VideoFrame): void { frame.close(); this.open--; }

  dispose(): void {
    if (this.decoder.state !== "closed") this.decoder.close();
  }
}
