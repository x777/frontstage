import { peakEnvelopeFromPcm } from "@frontstage/core";
import type { MediaManifestEntry } from "@frontstage/core";
import { decodeWavPcm16Mono } from "@frontstage/engine";

/**
 * Per-media peak envelopes (Palmier 0=loud, 1=silence) built from WAV PCM.
 * Video files that aren't WAV stay empty until a host feeds extracted PCM.
 */
export class WaveformCache {
  private samples = new Map<string, number[]>();
  private listeners = new Set<() => void>();

  getSnapshot(): Map<string, readonly number[]> {
    return this.samples;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  ingestPcm(mediaRef: string, pcm: ArrayLike<number>, sampleRate: number): void {
    const env = peakEnvelopeFromPcm(pcm, sampleRate);
    if (env.length === 0) return;
    this.samples.set(mediaRef, env);
    this.emit();
  }

  ingestWav(mediaRef: string, wav: Uint8Array): boolean {
    try {
      const decoded = decodeWavPcm16Mono(wav);
      this.ingestPcm(mediaRef, decoded.samples, decoded.sampleRate);
      return true;
    } catch {
      return false;
    }
  }

  samplesFor(mediaRef: string): readonly number[] | undefined {
    return this.samples.get(mediaRef);
  }

  ingestLibraryBytes(entries: readonly MediaManifestEntry[], bytesFor: (e: MediaManifestEntry) => Uint8Array | undefined): void {
    for (const e of entries) {
      if (this.samples.has(e.id)) continue;
      if (e.type !== "audio" && !(e.type === "video" && e.hasAudio)) continue;
      const bytes = bytesFor(e);
      if (bytes && bytes.length > 0) this.ingestWav(e.id, bytes);
    }
  }
}
