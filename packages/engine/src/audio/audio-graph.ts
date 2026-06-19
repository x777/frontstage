import type { PcmChunk } from "../decode/audio-decoder.js";
import { SabRingBuffer } from "./ring-buffer.js";

// Vite resolves the ?url import as a string at build/dev time.
// We use a type assertion so TS doesn't choke on the query-string suffix.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Vite ?url suffix not typed; resolved to string at runtime
import workletUrl from "./ring-worklet.ts?url";

export class AudioGraph {
  private constructor(
    private ctx: AudioContext,
    private node: AudioWorkletNode,
    private ring: SabRingBuffer,
  ) {}

  static async create(channels: number, sampleRate: number): Promise<AudioGraph> {
    if (!self.crossOriginIsolated) {
      throw new Error("EngineUnsupported: SharedArrayBuffer needs cross-origin isolation (COOP/COEP)");
    }
    const ctx = new AudioContext({ sampleRate });
    await ctx.audioWorklet.addModule(workletUrl);
    const capacityFrames = sampleRate; // ~1s buffer
    const ring = SabRingBuffer.create(capacityFrames, channels);
    const node = new AudioWorkletNode(ctx, "ring-processor", {
      outputChannelCount: [channels],
      processorOptions: { sab: ring.sab, channels, capacityFrames },
    });
    node.connect(ctx.destination);
    return new AudioGraph(ctx, node, ring);
  }

  pushPcm(pcm: PcmChunk): void {
    this.ring.write(pcm.data);
  }

  async start(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  stop(): void {
    void this.ctx.suspend();
  }

  get currentTime(): number {
    return this.ctx.currentTime;
  }

  get availableRead(): number {
    return this.ring.availableRead();
  }

  dispose(): void {
    this.node.disconnect();
    void this.ctx.close();
  }
}
