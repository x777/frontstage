import {
  type Timeline, type Size, buildRenderPlan,
  timelineTotalFrames, frameToSeconds,
} from "@palmier/core";
import type { MediaByteSource } from "./media/media-source.js";
import { demuxMp4 } from "./demux/mp4-demuxer.js";
import { buildVideoChunks, VideoDecodeManager } from "./decode/video-decoder.js";
import { buildAudioChunks, AudioDecodeManager, type PcmChunk } from "./decode/audio-decoder.js";
import { AudioGraph } from "./audio/audio-graph.js";
import { FrameRenderer } from "./render/webgpu-renderer.js";
import { PlayClock } from "./clock/play-clock.js";

type StateCb = (s: { currentFrame: number; isPlaying: boolean }) => void;

export class PlaybackEngine {
  private timeline?: Timeline;
  private decoder?: VideoDecodeManager;
  private natSize: Size = { width: 0, height: 0 };
  private _currentFrame = 0;
  private _isPlaying = false;
  private cbs = new Set<StateCb>();

  private seekSeq = 0;
  private decodeGate: Promise<void> = Promise.resolve();
  private lastSeekError: unknown = undefined;

  private clock?: PlayClock;
  private raf = 0;

  private audio?: AudioGraph;
  private audioDecode?: AudioDecodeManager;
  private pcmChunks: PcmChunk[] = [];
  private pcmCursor = 0;

  private constructor(private renderer: FrameRenderer, private canvas: HTMLCanvasElement) {}

  static async create(canvas: HTMLCanvasElement): Promise<PlaybackEngine> {
    return new PlaybackEngine(await FrameRenderer.create(canvas), canvas);
  }

  async load(timeline: Timeline, media: MediaByteSource): Promise<void> {
    this.timeline = timeline;
    this.canvas.width = timeline.width;
    this.canvas.height = timeline.height;
    const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.mediaType === "video");
    if (!clip) throw new Error("no video clip in timeline");
    const blob = await media.open(clip.mediaRef);
    const bytes = await blob.arrayBuffer();
    const demux = await demuxMp4(new Blob([bytes]));
    if (!demux.video) throw new Error("no video track");
    this.natSize = { width: demux.video.codedWidth, height: demux.video.codedHeight };
    const chunks = buildVideoChunks(demux.video, bytes);
    this.decoder = await VideoDecodeManager.create(demux.video, chunks);
    if (demux.audio) {
      const aChunks = buildAudioChunks(demux.audio, bytes);
      try {
        this.audio = await AudioGraph.create(demux.audio.channels, demux.audio.sampleRate);
        this.audioDecode = await AudioDecodeManager.create(demux.audio, aChunks);
      } catch (e) {
        console.warn("audio init failed (non-fatal):", e);
        this.audio = undefined;
        this.audioDecode = undefined;
      }
    }
    await this.seek(0, "exact");
  }

  // mode (exact vs low-latency scrub) is used in Plan 2c
  async seek(frame: number, _mode: "exact" | "scrub"): Promise<void> {
    if (this._isPlaying) this.pause();
    if (!this.timeline || !this.decoder) return;
    const seq = ++this.seekSeq;
    const durationFrames = this.durationFrames;
    const clamped = Math.max(0, Math.min(frame, Math.max(0, durationFrames - 1)));
    const plan = buildRenderPlan(this.timeline, clamped, new Map([[
      this.firstVideoMediaRef(), this.natSize,
    ]]));
    const layer = plan.layers[0];
    const sourceUs = this.sourceMicrosForFrame(clamped);
    let vframe: VideoFrame | undefined;
    this.decodeGate = this.decodeGate.then(async () => {
      if (seq !== this.seekSeq) return;
      vframe = await this.decoder!.frameAtMicros(Math.max(0, sourceUs));
    }).catch((e) => { this.lastSeekError = e; console.warn("seek decode error:", e); });
    await this.decodeGate;
    if (!vframe) return;
    try {
      if (seq !== this.seekSeq) return;
      this._currentFrame = clamped;
      if (layer) {
        await this.renderer.present(vframe, layer.transform, { width: this.timeline.width, height: this.timeline.height });
      }
      this.emit();
    } finally {
      this.decoder?.closeFrame(vframe);
    }
  }

  play(): void {
    if (!this.timeline || !this.decoder || this._isPlaying) return;
    this._isPlaying = true;
    const clip = this.firstVideoClip();
    const startFrame = this._currentFrame;
    void (async () => {
      await this.decoder!.seekTo(this.sourceMicrosForFrame(startFrame));
      if (!this._isPlaying) return;
      if (this.audio && this.audioDecode) {
        this.pcmChunks = [];
        this.pcmCursor = 0;
        try {
          await this.audioDecode.decodeAll((pcm) => { this.pcmChunks.push(pcm); });
        } catch (e) {
          console.warn("audio decode error:", e);
        }
        await this.audio.start();
      }
      if (!this._isPlaying) return;
      this.clock = new PlayClock(
        this.timeline!.fps,
        this.audio ? () => this.audio!.currentTime * 1000 : undefined,
      );
      this.clock.start(startFrame);
      this.raf = requestAnimationFrame(() => void tick());
    })().catch((e) => {
      console.warn("play error:", e);
      if (this._isPlaying) { this._isPlaying = false; this.emit(); }
    });

    const tick = async (): Promise<void> => {
      if (!this._isPlaying || !this.clock || !this.decoder || !this.timeline) return;
      this.decoder.pump();
      // Feed ring incrementally: push next chunk only when there's room
      if (this.audio && this.pcmCursor < this.pcmChunks.length) {
        const chunk = this.pcmChunks[this.pcmCursor]!;
        const chunkFrames = Math.floor(chunk.data.length / chunk.channels);
        if (this.audio.freeSpaceFrames >= chunkFrames) {
          this.audio.pushPcm(chunk);
          this.pcmCursor++;
        }
      }
      const frame = Math.floor(this.clock.frame);
      if (frame >= this.durationFrames) {
        this._currentFrame = Math.max(0, this.durationFrames - 1);
        this.pause();
        return;
      }
      this._currentFrame = frame;
      const f = this.decoder.frameForMicros(this.sourceMicrosForFrame(frame));
      const plan = buildRenderPlan(this.timeline, frame, new Map([[clip.mediaRef, this.natSize]]));
      this.raf = 0;
      if (f && plan.layers[0]) await this.renderer.present(f, plan.layers[0].transform, { width: this.timeline.width, height: this.timeline.height });
      this.emit();
      if (this._isPlaying) this.raf = requestAnimationFrame(() => void tick());
    };
  }

  pause(): void {
    this._isPlaying = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clock?.pause();
    this.audio?.stop();
    this.decoder?.clearPumpBuffer();
    this.emit();
  }

  get isPlaying(): boolean { return this._isPlaying; }

  private sourceMicrosForFrame(frame: number): number {
    const clip = this.firstVideoClip();
    return Math.round(
      frameToSeconds(clip.trimStartFrame + (frame - clip.startFrame) * clip.speed, this.timeline!.fps) * 1_000_000,
    );
  }

  private firstVideoClip() {
    return this.timeline!.tracks.flatMap((t) => t.clips).find((c) => c.mediaType === "video")!;
  }

  private firstVideoMediaRef(): string {
    return this.firstVideoClip().mediaRef;
  }

  get currentFrame(): number { return this._currentFrame; }
  get durationFrames(): number { return this.timeline ? timelineTotalFrames(this.timeline) : 0; }
  openFrameCount(): number { return this.decoder?.openFrameCount() ?? 0; }
  onStateChange(cb: StateCb): () => void { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  private emit(): void { for (const cb of this.cbs) cb({ currentFrame: this._currentFrame, isPlaying: this._isPlaying }); }
  get __audioCurrentTime(): (() => number) | undefined {
    return this.audio ? () => this.audio!.currentTime : undefined;
  }

  dispose(): void { this.pause(); this.audio?.dispose(); this.decoder?.dispose(); this.renderer.dispose(); }
}
