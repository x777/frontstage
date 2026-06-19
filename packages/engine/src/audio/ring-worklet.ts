// AudioWorkletGlobalScope — no imports, no DOM, no bundler globals.
// Header layout MUST match SabRingBuffer: [readIdx, writeIdx] as Int32 at byte offsets 0,4; data as Float32 at byte offset 8.

// Ambient stubs for AudioWorkletGlobalScope globals (not in standard lib.dom.d.ts).
declare abstract class AudioWorkletProcessor {
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

class RingProcessor extends AudioWorkletProcessor {
  private header: Int32Array;
  private data: Float32Array;
  private channels: number;
  private capacity: number;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { sab, channels, capacityFrames } = options.processorOptions as {
      sab: SharedArrayBuffer;
      channels: number;
      capacityFrames: number;
    };
    this.header = new Int32Array(sab, 0, 2);
    this.data = new Float32Array(sab, 8);
    this.channels = channels;
    this.capacity = capacityFrames;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    const frames = out[0]!.length;
    const read = Atomics.load(this.header, 0);
    const write = Atomics.load(this.header, 1);
    const avail = (write - read + this.capacity) % this.capacity;
    const n = Math.min(frames, avail);
    for (let i = 0; i < frames; i++) {
      if (i < n) {
        const base = ((read + i) % this.capacity) * this.channels;
        // Math.min clamps ch to last source channel, upmixing when output has more channels than source.
        for (let ch = 0; ch < out.length; ch++) {
          out[ch]![i] = this.data[base + Math.min(ch, this.channels - 1)]!;
        }
      } else {
        for (let ch = 0; ch < out.length; ch++) out[ch]![i] = 0;
      }
    }
    Atomics.store(this.header, 0, (read + n) % this.capacity);
    return true;
  }
}

registerProcessor("ring-processor", RingProcessor);
