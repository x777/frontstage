import {
  type Timeline, type Size, buildRenderPlan,
  timelineTotalFrames, frameToSeconds,
} from "@palmier/core";
import type { MediaByteSource } from "./media/media-source.js";
import { demuxMp4 } from "./demux/mp4-demuxer.js";
import { buildVideoChunks, VideoDecodeManager } from "./decode/video-decoder.js";
import { FrameRenderer } from "./render/webgpu-renderer.js";

type StateCb = (s: { currentFrame: number; isPlaying: boolean }) => void;

export class PlaybackEngine {
  private timeline?: Timeline;
  private decoder?: VideoDecodeManager;
  private natSize: Size = { width: 0, height: 0 };
  private _currentFrame = 0;
  private cbs = new Set<StateCb>();

  private seekSeq = 0;

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
    await this.seek(0, "exact");
  }

  // mode (exact vs low-latency scrub) is used in Plan 2c
  async seek(frame: number, _mode: "exact" | "scrub"): Promise<void> {
    if (!this.timeline || !this.decoder) return;
    const seq = ++this.seekSeq;
    const durationFrames = this.durationFrames;
    const clamped = Math.max(0, Math.min(frame, Math.max(0, durationFrames - 1)));
    const plan = buildRenderPlan(this.timeline, clamped, new Map([[
      this.firstVideoMediaRef(), this.natSize,
    ]]));
    const layer = plan.layers[0];
    const clip = this.timeline.tracks.flatMap((t) => t.clips).find((c) => c.mediaType === "video")!;
    const sourceUs = Math.round(
      frameToSeconds(clip.trimStartFrame + (clamped - clip.startFrame) * clip.speed, this.timeline.fps) * 1_000_000,
    );
    const vframe = await this.decoder.frameAtMicros(Math.max(0, sourceUs));
    try {
      if (seq !== this.seekSeq) return;
      this._currentFrame = clamped;
      if (layer) {
        // Decoded frames are software copies (cloned in VideoDecodeManager to survive decoder.close()).
        // importExternalTexture requires an ImageBitmap-backed VideoFrame — promote via OffscreenCanvas.
        const off = new OffscreenCanvas(vframe.displayWidth, vframe.displayHeight);
        off.getContext("2d")!.drawImage(vframe, 0, 0);
        const bitmap = off.transferToImageBitmap();
        const gpuFrame = new VideoFrame(bitmap, { timestamp: vframe.timestamp });
        bitmap.close();
        try {
          this.renderer.present(gpuFrame, layer.transform, { width: this.timeline.width, height: this.timeline.height });
        } finally {
          gpuFrame.close();
        }
      }
      this.emit();
    } finally {
      this.decoder.closeFrame(vframe);
    }
  }

  private firstVideoMediaRef(): string {
    return this.timeline!.tracks.flatMap((t) => t.clips).find((c) => c.mediaType === "video")!.mediaRef;
  }

  get currentFrame(): number { return this._currentFrame; }
  get durationFrames(): number { return this.timeline ? timelineTotalFrames(this.timeline) : 0; }
  openFrameCount(): number { return this.decoder?.openFrameCount() ?? 0; }
  onStateChange(cb: StateCb): () => void { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  private emit(): void { for (const cb of this.cbs) cb({ currentFrame: this._currentFrame, isPlaying: false }); }
  dispose(): void { this.decoder?.dispose(); this.renderer.dispose(); }
}
