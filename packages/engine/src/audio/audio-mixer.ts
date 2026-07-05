import { buildAudioPlan, timelineTotalFrames, type AudioPlan } from "@frontstage/core";
import type { Clip, Timeline } from "@frontstage/core";
import type { MediaByteSource } from "../media/media-source.js";
import { demuxMp4 } from "../demux/mp4-demuxer.js";
import { buildAudioChunks, AudioDecodeManager } from "../decode/audio-decoder.js";
import type { AudioGraph } from "./audio-graph.js";
import { mixWindow, type MixSource } from "./mix.js";

export function audioMixClips(timeline: Timeline): Clip[] {
  return timeline.tracks
    .filter((t) => !t.hidden && !t.muted)
    .flatMap((t) => t.clips)
    .filter((c) => c.mediaType === "audio");
}

const CHUNK = 2048;

export class AudioMixer {
  private sources: MixSource[];
  private clipIds: string[];
  private _channels: number;
  private _sampleRate: number;
  private cursor = 0;
  private planCache = new Map<number, AudioPlan>();
  private _ended = false;
  // Exposed for testing: peak absolute value of the most recently fed mixed chunk
  __lastPeak = 0;
  __mixFed = 0;

  private constructor(sources: MixSource[], clipIds: string[], channels: number, sampleRate: number) {
    this.sources = sources;
    this.clipIds = clipIds;
    this._channels = channels;
    this._sampleRate = sampleRate;
  }

  static async create(timeline: Timeline, media: MediaByteSource): Promise<AudioMixer | undefined> {
    const allClips = audioMixClips(timeline);

    if (allClips.length === 0) return undefined;

    // Demux each unique mediaRef once. Missing/broken media for one ref must not sink the whole
    // mix (or export) — skip it, warn once, and let that clip contribute silence.
    const demuxCache = new Map<string, { bytes: ArrayBuffer; audio?: import("../demux/mp4-demuxer.js").DemuxedAudioTrack }>();
    const failedRefs = new Set<string>();
    for (const clip of allClips) {
      if (demuxCache.has(clip.mediaRef) || failedRefs.has(clip.mediaRef)) continue;
      let bytes: ArrayBuffer;
      try {
        const blob = await media.open(clip.mediaRef);
        bytes = await blob.arrayBuffer();
      } catch (e) {
        console.warn(`audio media open failed for ${clip.mediaRef}, skipping:`, e);
        failedRefs.add(clip.mediaRef);
        continue;
      }
      try {
        const demux = await demuxMp4(new Blob([bytes]));
        demuxCache.set(clip.mediaRef, { bytes, audio: demux.audio });
      } catch {
        // mp3/wav/… aren't ISO-BMFF — the WebAudio fallback below decodes those containers.
        demuxCache.set(clip.mediaRef, { bytes });
      }
    }

    // Decode PCM once per mediaRef and share across clips referencing the same media
    const decoded = new Map<string, { pcm: Float32Array; channels: number; sampleRate: number }>();
    let outChannels: number | undefined;
    let outSampleRate: number | undefined;

    for (const [ref, entry] of demuxCache) {
      if (!entry.audio) continue;
      const { bytes, audio } = entry;
      const chunks = buildAudioChunks(audio, bytes);
      let manager: AudioDecodeManager;
      try {
        manager = await AudioDecodeManager.create(audio, chunks);
      } catch {
        continue; // unsupported codec — skip silently
      }

      const pcmParts: Float32Array[] = [];
      await manager.decodeAll((pcm) => { pcmParts.push(pcm.data); });

      const totalLen = pcmParts.reduce((n, p) => n + p.length, 0);
      if (totalLen === 0) continue;
      const pcm = new Float32Array(totalLen);
      let off = 0;
      for (const part of pcmParts) { pcm.set(part, off); off += part.length; }

      decoded.set(ref, { pcm, channels: audio.channels, sampleRate: audio.sampleRate });
      if (outChannels === undefined) { outChannels = audio.channels; outSampleRate = audio.sampleRate; }
    }

    // WebAudio fallback for refs mp4box couldn't demux. Runs after the mp4 pass so it decodes
    // straight at the established mix format (rate via OfflineAudioContext resampling, channels
    // conformed manually) — heterogeneous sources would otherwise throw below.
    for (const [ref, entry] of demuxCache) {
      if (entry.audio || decoded.has(ref)) continue;
      const fb = await decodeAudioBytesFallback(entry.bytes, outSampleRate ?? 48000, outChannels);
      if (!fb) {
        console.warn(`audio decode failed for ${ref} (unsupported container/codec), skipping`);
        continue;
      }
      decoded.set(ref, fb);
      if (outChannels === undefined) { outChannels = fb.channels; outSampleRate = fb.sampleRate; }
    }

    const sources: MixSource[] = [];
    const clipIds: string[] = [];

    for (const clip of allClips) {
      const dec = decoded.get(clip.mediaRef);
      if (!dec) continue;

      sources.push({
        pcm: dec.pcm,
        channels: dec.channels,
        sampleRate: dec.sampleRate,
        startFrame: clip.startFrame,
        endFrame: clip.startFrame + clip.durationFrames,
        trimStartFrame: clip.trimStartFrame,
        speed: clip.speed,
      });
      clipIds.push(clip.id);
    }

    if (sources.length === 0) return undefined;

    for (const src of sources) {
      if (src.sampleRate !== outSampleRate || src.channels !== outChannels) {
        throw new Error("EngineUnsupported: heterogeneous audio (mixed sample rates / channel counts) not yet supported");
      }
    }

    return new AudioMixer(sources, clipIds, outChannels!, outSampleRate!);
  }

  get channels(): number { return this._channels; }
  get sampleRate(): number { return this._sampleRate; }

  reset(fromFrame: number, fps: number): void {
    this.cursor = Math.round((fromFrame / fps) * this._sampleRate);
    this.planCache.clear();
    this._ended = false;
    this.__lastPeak = 0;
    this.__mixFed = 0;
  }

  mixNext(timeline: Timeline, fps: number): Float32Array | undefined {
    const endSample = Math.ceil(timelineTotalFrames(timeline) / fps * this._sampleRate);
    if (this._ended || this.cursor >= endSample) {
      this._ended = true;
      return undefined;
    }

    const gainFor = (i: number, timelineFrame: number): number => {
      let plan = this.planCache.get(timelineFrame);
      if (!plan) {
        plan = buildAudioPlan(timeline, timelineFrame);
        this.planCache.set(timelineFrame, plan);
      }
      const clipId = this.clipIds[i];
      return plan.clips.find((c) => c.clipId === clipId)?.gain ?? 0;
    };

    const mixed = mixWindow(this.sources, this.cursor, CHUNK, this._sampleRate, fps, gainFor);

    let peak = 0;
    for (let i = 0; i < mixed.length; i++) {
      const v = Math.abs(mixed[i]!);
      if (v > peak) peak = v;
    }
    this.__lastPeak = Math.max(this.__lastPeak, peak);
    this.__mixFed += CHUNK;

    this.cursor += CHUNK;
    return mixed;
  }

  feed(graph: AudioGraph, timeline: Timeline, fps: number): void {
    while (graph.freeSpaceFrames >= CHUNK) {
      const w = this.mixNext(timeline, fps);
      if (!w) break;
      graph.pushPcm({ timestampUs: 0, sampleRate: this._sampleRate, channels: this._channels, data: w });
    }
  }

  dispose(): void {
    this.sources = [];
    this.planCache.clear();
  }
}

// mp3/wav/aac files aren't ISO-BMFF — mp4box can't demux them, but WebAudio's decoder sniffs
// those containers natively. Decodes at targetRate (OfflineAudioContext resamples) and conforms
// the channel count (mono duplicates up; extra channels drop) so the source can join an
// established mp4-decoded mix without tripping the heterogeneous-audio guard.
async function decodeAudioBytesFallback(
  bytes: ArrayBuffer,
  targetRate: number,
  targetChannels?: number,
): Promise<{ pcm: Float32Array; channels: number; sampleRate: number } | undefined> {
  if (typeof OfflineAudioContext === "undefined") return undefined;
  try {
    const ctx = new OfflineAudioContext(targetChannels ?? 2, 1, targetRate);
    const buf = await ctx.decodeAudioData(bytes.slice(0));
    const channels = targetChannels ?? buf.numberOfChannels;
    const frames = buf.length;
    const pcm = new Float32Array(frames * channels);
    for (let ch = 0; ch < channels; ch++) {
      const plane = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      for (let i = 0; i < frames; i++) pcm[i * channels + ch] = plane[i]!;
    }
    return { pcm, channels, sampleRate: targetRate };
  } catch {
    return undefined;
  }
}
