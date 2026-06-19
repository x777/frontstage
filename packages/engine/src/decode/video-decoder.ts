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

export interface EngineDecodeError { message: string; }

interface KeyframeEntry { chunkIndex: number; micros: number; }

export class VideoDecodeManager {
  private decoder!: VideoDecoder;
  private open = 0;
  private keyframes: KeyframeEntry[] = [];
  private err: EngineDecodeError | null = null;
  private collected: VideoFrame[] = [];

  private constructor(private track: DemuxedTrack, private chunks: EncodedVideoChunk[]) {}

  static async create(track: DemuxedTrack, chunks: EncodedVideoChunk[]): Promise<VideoDecodeManager> {
    const m = new VideoDecodeManager(track, chunks);
    m.keyframes = chunks
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.type === "key")
      .map(({ c, i }) => ({ chunkIndex: i, micros: c.timestamp }));
    const config: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.codedWidth,
      codedHeight: track.codedHeight,
      ...(track.description ? { description: track.description } : {}),
      optimizeForLatency: true,
    };
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`EngineUnsupported: codec ${track.codec}`);
    m.decoder = new VideoDecoder({
      output: (f) => { m.open++; m.collected.push(f); },
      error: (e: Error) => { m.err = { message: e.message }; },
    });
    m.decoder.configure(config);
    return m;
  }

  private keyframeIndexBefore(targetUs: number): number {
    let lo = 0, hi = this.keyframes.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.keyframes[mid]!.micros <= targetUs) { ans = this.keyframes[mid]!.chunkIndex; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  openFrameCount(): number { return this.open; }
  lastError(): EngineDecodeError | undefined { return this.err ?? undefined; }
  closeFrame(frame: VideoFrame): void { frame.close(); this.open--; }

  async frameAtMicros(targetUs: number): Promise<VideoFrame> {
    this.err = null;
    // drop anything buffered from a previous call
    for (const f of this.collected) { f.close(); this.open--; }
    this.collected = [];
    const startIdx = this.keyframeIndexBefore(targetUs);
    for (let i = startIdx; i < this.chunks.length; i++) {
      this.decoder.decode(this.chunks[i]!);
      if (this.chunks[i]!.timestamp >= targetUs) break;
    }
    await this.decoder.flush();
    const capturedErr = this.err as EngineDecodeError | null;
    if (capturedErr !== null) {
      for (const f of this.collected) { try { f.close(); } catch (_e) { /* ignore */ } this.open--; }
      this.collected = [];
      throw new Error(`EngineDecode: ${capturedErr.message}`);
    }
    // pick closest <= target; fall back to earliest frame past target
    let best: VideoFrame | undefined;
    let fallback: VideoFrame | undefined;
    for (const f of this.collected) {
      if (f.timestamp <= targetUs) {
        if (!best || f.timestamp > best.timestamp) {
          if (best) { best.close(); this.open--; }
          best = f;
        } else { f.close(); this.open--; }
      } else {
        if (!fallback || f.timestamp < fallback.timestamp) {
          if (fallback) { fallback.close(); this.open--; }
          fallback = f;
        } else { f.close(); this.open--; }
      }
    }
    this.collected = [];
    if (best) {
      if (fallback) { fallback.close(); this.open--; }
    } else {
      best = fallback;
    }
    if (!best) throw new Error("no frame decoded");
    return best; // decoder stays alive → frame GPU-backed → directly importable
  }

  dispose(): void {
    for (const f of this.collected) { try { f.close(); this.open--; } catch { /* already closed */ } }
    this.collected = [];
    if (this.decoder.state !== "closed") this.decoder.close();
  }
}
