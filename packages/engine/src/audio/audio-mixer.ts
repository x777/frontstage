import { buildAudioPlan, type AudioPlan } from "@palmier/core";
import type { Timeline } from "@palmier/core";
import type { MediaByteSource } from "../media/media-source.js";
import { demuxMp4 } from "../demux/mp4-demuxer.js";
import { buildAudioChunks, AudioDecodeManager } from "../decode/audio-decoder.js";
import type { AudioGraph } from "./audio-graph.js";
import { mixWindow, type MixSource } from "./mix.js";

const CHUNK = 2048;

export class AudioMixer {
  private sources: MixSource[];
  private clipIds: string[];
  private _channels: number;
  private _sampleRate: number;
  private cursor = 0;
  private planCache = new Map<number, AudioPlan>();
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
    // Collect clips that carry audio (audio or video mediaType)
    const allClips = timeline.tracks
      .filter((t) => !t.hidden)
      .flatMap((t) => t.clips)
      .filter((c) => c.mediaType === "audio" || c.mediaType === "video");

    if (allClips.length === 0) return undefined;

    // Demux each unique mediaRef once
    const demuxCache = new Map<string, { bytes: ArrayBuffer; audio?: import("../demux/mp4-demuxer.js").DemuxedAudioTrack }>();
    for (const clip of allClips) {
      if (demuxCache.has(clip.mediaRef)) continue;
      const blob = await media.open(clip.mediaRef);
      const bytes = await blob.arrayBuffer();
      const demux = await demuxMp4(new Blob([bytes]));
      demuxCache.set(clip.mediaRef, { bytes, audio: demux.audio });
    }

    const sources: MixSource[] = [];
    const clipIds: string[] = [];
    let outChannels: number | undefined;
    let outSampleRate: number | undefined;

    for (const clip of allClips) {
      const entry = demuxCache.get(clip.mediaRef)!;
      if (!entry.audio) continue; // media has no audio track

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

      // Concatenate interleaved PCM parts
      const totalLen = pcmParts.reduce((n, p) => n + p.length, 0);
      if (totalLen === 0) continue;
      const pcm = new Float32Array(totalLen);
      let off = 0;
      for (const part of pcmParts) { pcm.set(part, off); off += part.length; }

      if (outChannels === undefined) { outChannels = audio.channels; outSampleRate = audio.sampleRate; }

      sources.push({
        pcm,
        channels: audio.channels,
        sampleRate: audio.sampleRate,
        startFrame: clip.startFrame,
        endFrame: clip.startFrame + clip.durationFrames,
        trimStartFrame: clip.trimStartFrame,
        speed: clip.speed,
      });
      clipIds.push(clip.id);
    }

    if (sources.length === 0) return undefined;
    return new AudioMixer(sources, clipIds, outChannels!, outSampleRate!);
  }

  get channels(): number { return this._channels; }
  get sampleRate(): number { return this._sampleRate; }

  reset(fromFrame: number, fps: number): void {
    this.cursor = Math.round((fromFrame / fps) * this._sampleRate);
    this.planCache.clear();
    this.__lastPeak = 0;
  }

  feed(graph: AudioGraph, timeline: Timeline, fps: number): void {
    while (graph.freeSpaceFrames >= CHUNK) {
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

      // Track peak for test inspection
      let peak = 0;
      for (let i = 0; i < mixed.length; i++) {
        const v = Math.abs(mixed[i]!);
        if (v > peak) peak = v;
      }
      this.__lastPeak = Math.max(this.__lastPeak, peak);
      this.__mixFed += CHUNK;

      graph.pushPcm({ timestampUs: 0, sampleRate: this._sampleRate, channels: this._channels, data: mixed });
      this.cursor += CHUNK;
    }
  }

  dispose(): void {
    this.sources = [];
    this.planCache.clear();
  }
}
