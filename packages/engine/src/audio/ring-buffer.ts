// SAB ring buffer: header [readIdx, writeIdx] as Int32 at offsets 0,1; PCM data as Float32 at byte offset 8.
// Indices are modular over capacityFrames. Falls back to ArrayBuffer when SAB is unavailable (Vitest).

export class SabRingBuffer {
  private header: Int32Array;
  private data: Float32Array;
  readonly sab: SharedArrayBuffer | ArrayBuffer;

  private constructor(
    buf: SharedArrayBuffer | ArrayBuffer,
    private channels: number,
    private capacityFrames: number,
  ) {
    this.sab = buf;
    this.header = new Int32Array(buf, 0, 2);
    this.data = new Float32Array(buf, 8);
  }

  static create(capacityFrames: number, channels: number): SabRingBuffer {
    const headerBytes = 8; // 2 x Int32
    const dataBytes = capacityFrames * channels * 4;
    const buf =
      typeof SharedArrayBuffer !== "undefined"
        ? new SharedArrayBuffer(headerBytes + dataBytes)
        : new ArrayBuffer(headerBytes + dataBytes);
    return new SabRingBuffer(buf, channels, capacityFrames);
  }

  static fromSab(sab: SharedArrayBuffer, channels: number, capacityFrames: number): SabRingBuffer {
    return new SabRingBuffer(sab, channels, capacityFrames);
  }

  write(interleaved: Float32Array): number {
    const read = Atomics.load(this.header, 0);
    const write = Atomics.load(this.header, 1);
    // One slot reserved to disambiguate full vs empty; usable capacity is capacityFrames - 1 frames.
    const avail = (this.capacityFrames - ((write - read + this.capacityFrames) % this.capacityFrames) - 1);
    const inFrames = Math.floor(interleaved.length / this.channels);
    const n = Math.min(inFrames, avail);
    for (let i = 0; i < n; i++) {
      const base = ((write + i) % this.capacityFrames) * this.channels;
      for (let ch = 0; ch < this.channels; ch++) {
        this.data[base + ch] = interleaved[i * this.channels + ch]!;
      }
    }
    Atomics.store(this.header, 1, (write + n) % this.capacityFrames);
    return n;
  }

  availableRead(): number {
    const read = Atomics.load(this.header, 0);
    const write = Atomics.load(this.header, 1);
    return (write - read + this.capacityFrames) % this.capacityFrames;
  }

  read(out: Float32Array, frames: number): number {
    const read = Atomics.load(this.header, 0);
    const write = Atomics.load(this.header, 1);
    const avail = (write - read + this.capacityFrames) % this.capacityFrames;
    const n = Math.min(frames, avail);
    for (let i = 0; i < n; i++) {
      const base = ((read + i) % this.capacityFrames) * this.channels;
      for (let ch = 0; ch < this.channels; ch++) {
        out[i * this.channels + ch] = this.data[base + ch]!;
      }
    }
    Atomics.store(this.header, 0, (read + n) % this.capacityFrames);
    return n;
  }

  reset(): void {
    Atomics.store(this.header, 0, 0);
    Atomics.store(this.header, 1, 0);
  }
}
