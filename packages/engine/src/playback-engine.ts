import {
  type Timeline,
  timelineTotalFrames,
} from "@palmier/core";
import type { MediaByteSource } from "./media/media-source.js";
import { AudioGraph } from "./audio/audio-graph.js";
import { AudioMixer } from "./audio/audio-mixer.js";
import { FrameRenderer } from "./render/webgpu-renderer.js";
import { PlayClock } from "./clock/play-clock.js";
import { SourceCoordinator } from "./compositor/source-coordinator.js";

type StateCb = (s: { currentFrame: number; isPlaying: boolean }) => void;

export class PlaybackEngine {
  private timeline?: Timeline;
  private coordinator?: SourceCoordinator;
  private _currentFrame = 0;
  private _isPlaying = false;
  private cbs = new Set<StateCb>();

  private seekSeq = 0;
  private playSeq = 0;
  private decodeGate: Promise<void> = Promise.resolve();
  private lastSeekError: unknown = undefined;

  private clock?: PlayClock;
  private raf = 0;

  private audio?: AudioGraph;
  private audioMixer?: AudioMixer;

  private media?: MediaByteSource;
  private _lastLayerCount = 0;

  private constructor(private renderer: FrameRenderer, private canvas: HTMLCanvasElement) {}

  get __lastLayerCount(): number { return this._lastLayerCount; }

  static async create(canvas: HTMLCanvasElement): Promise<PlaybackEngine> {
    return new PlaybackEngine(await FrameRenderer.create(canvas), canvas);
  }

  async load(timeline: Timeline, media: MediaByteSource): Promise<void> {
    this.timeline = timeline;
    this.media = media;
    this.canvas.width = timeline.width;
    this.canvas.height = timeline.height;
    this.coordinator = await SourceCoordinator.create(timeline, media);
    try {
      this.audioMixer = await AudioMixer.create(timeline, media);
      if (this.audioMixer) {
        this.audio = await AudioGraph.create(this.audioMixer.channels, this.audioMixer.sampleRate);
      }
    } catch (e) {
      console.warn("audio init failed (non-fatal):", e);
      this.audioMixer = undefined;
      this.audio = undefined;
    }
    await this.seek(0, "exact");
  }

  async setTimeline(timeline: Timeline): Promise<void> {
    if (!this.coordinator || !this.media) return;
    ++this.seekSeq; // invalidate any in-flight seek before reconcile disposes sources
    this.timeline = timeline;
    await this.coordinator.reconcile(timeline);

    const prevChannels = this.audioMixer?.channels;
    const prevSampleRate = this.audioMixer?.sampleRate;
    this.audioMixer?.dispose();
    try {
      this.audioMixer = await AudioMixer.create(timeline, this.media);
      if (this.audioMixer) {
        const channelsChanged = this.audioMixer.channels !== prevChannels;
        const rateChanged = this.audioMixer.sampleRate !== prevSampleRate;
        if (channelsChanged || rateChanged || !this.audio) {
          this.audio?.dispose();
          this.audio = await AudioGraph.create(this.audioMixer.channels, this.audioMixer.sampleRate);
        }
      } else {
        this.audio?.dispose();
        this.audio = undefined;
      }
    } catch (e) {
      console.warn("audio rebuild failed (non-fatal):", e);
      this.audioMixer = undefined;
      this.audio = undefined;
    }

    if (!this._isPlaying) {
      await this.seek(this._currentFrame, "exact");
    }
  }

  // mode (exact vs low-latency scrub) is used in Plan 2c
  async seek(frame: number, _mode: "exact" | "scrub"): Promise<void> {
    if (this._isPlaying) this.pause();
    if (!this.timeline || !this.coordinator) return;
    const seq = ++this.seekSeq;
    const durationFrames = this.durationFrames;
    const clamped = Math.max(0, Math.min(frame, Math.max(0, durationFrames - 1)));
    this.decodeGate = this.decodeGate.then(async () => {
      if (seq !== this.seekSeq) return;
      const { layers, cleanup } = await this.coordinator!.layersForScrub(clamped);
      try {
        if (seq !== this.seekSeq) return;
        this._currentFrame = clamped;
        this._lastLayerCount = layers.length;
        await this.renderer.composite(layers, { width: this.timeline!.width, height: this.timeline!.height });
        this.emit();
      } finally { cleanup(); }
    }).catch((e) => { this.lastSeekError = e; console.warn("seek error:", e); });
    await this.decodeGate;
  }

  play(): void {
    if (!this.timeline || !this.coordinator || this._isPlaying) return;
    this._isPlaying = true;
    const startFrame = this._currentFrame;
    const fps = this.timeline.fps;
    void (async () => {
      const pseq = ++this.playSeq;
      this.audio?.reset();
      await this.coordinator!.seekAllTo(startFrame);
      if (!this._isPlaying || pseq !== this.playSeq) return;
      await this.coordinator!.primeAt(startFrame);
      if (!this._isPlaying || pseq !== this.playSeq) return;
      this.audioMixer?.reset(startFrame, fps);
      if (this.audio) {
        try {
          await this.audio.start();
        } catch (e) {
          console.warn("audio start error:", e);
        }
      }
      if (!this._isPlaying) return;
      this.clock = new PlayClock(
        this.timeline!.fps,
        this.audio ? () => this.audio!.currentTime * 1000 : undefined,
      );
      this.clock.start(startFrame);
      // Render the exact start frame now (buffer primed) so the first visible frame matches the
      // playhead — without this the clock has already advanced ~1 frame by the first raf tick.
      this._currentFrame = startFrame;
      await this.renderer.composite(this.coordinator!.layersForPlayback(startFrame), { width: this.timeline!.width, height: this.timeline!.height });
      this.raf = requestAnimationFrame(() => void tick());
    })().catch((e) => {
      console.warn("play error:", e);
      if (this._isPlaying) { this._isPlaying = false; this.emit(); }
    });

    const tick = async (): Promise<void> => {
      if (!this._isPlaying || !this.clock || !this.coordinator || !this.timeline) return;
      this.coordinator.pumpAll();
      if (this.audio && this.audioMixer) {
        this.audioMixer.feed(this.audio, this.timeline, this.timeline.fps);
      }
      const frame = Math.floor(this.clock.frame);
      if (frame >= this.durationFrames) {
        this._currentFrame = Math.max(0, this.durationFrames - 1);
        this.pause();
        return;
      }
      this._currentFrame = frame;
      const layers = this.coordinator!.layersForPlayback(frame);
      this.raf = 0;
      await this.renderer.composite(layers, { width: this.timeline!.width, height: this.timeline!.height });
      this.emit();
      if (this._isPlaying) this.raf = requestAnimationFrame(() => void tick());
    };
  }

  pause(): void {
    const fps = this.timeline?.fps ?? 30;
    this._isPlaying = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clock?.pause();
    this.audio?.stop();
    this.audio?.reset();
    this.audioMixer?.reset(this._currentFrame, fps);
    this.coordinator?.clearPumpBuffers();
    this.emit();
  }

  get isPlaying(): boolean { return this._isPlaying; }

  get currentFrame(): number { return this._currentFrame; }
  get durationFrames(): number { return this.timeline ? timelineTotalFrames(this.timeline) : 0; }
  openFrameCount(): number { return this.coordinator?.openFrameCount() ?? 0; }
  onStateChange(cb: StateCb): () => void { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  private emit(): void { for (const cb of this.cbs) cb({ currentFrame: this._currentFrame, isPlaying: this._isPlaying }); }
  get __audioCurrentTime(): (() => number) | undefined {
    return this.audio ? () => this.audio!.currentTime : undefined;
  }
  get __audioMixer(): AudioMixer | undefined { return this.audioMixer; }

  readPixel(x: number, y: number): Promise<[number, number, number, number]> {
    return this.renderer.readPixel(x, y);
  }

  dispose(): void { this.pause(); this.audio?.dispose(); this.audioMixer?.dispose(); this.coordinator?.dispose(); this.renderer.dispose(); }
}
