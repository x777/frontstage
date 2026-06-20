import { buildRenderPlan, frameToSeconds, type Clip, type Size, type Timeline } from "@palmier/core";
import { demuxMp4 } from "../demux/mp4-demuxer.js";
import { buildVideoChunks, VideoDecodeManager } from "../decode/video-decoder.js";
import { ImageSource } from "../media/image-source.js";
import type { MediaByteSource } from "../media/media-source.js";
import type { CompositeLayer } from "../render/composite-layer.js";

export function clipSourceMicros(clip: Clip, frame: number, fps: number): number {
  return Math.round(frameToSeconds(clip.trimStartFrame + (frame - clip.startFrame) * clip.speed, fps) * 1e6);
}

interface VideoEntry {
  type: "video";
  mgr: VideoDecodeManager;
  natSize: Size;
}

interface ImageEntry {
  type: "image";
  src: ImageSource;
  natSize: Size;
}

type SourceEntry = VideoEntry | ImageEntry;

export class SourceCoordinator {
  private constructor(
    private readonly timeline: Timeline,
    private readonly sources: Map<string, SourceEntry>,
    private readonly clipById: Map<string, Clip>,
    private readonly _sourceSizes: Map<string, Size>,
  ) {}

  static async create(timeline: Timeline, media: MediaByteSource): Promise<SourceCoordinator> {
    const sources = new Map<string, SourceEntry>();
    const clipById = new Map<string, Clip>();
    const sourceSizes = new Map<string, Size>();

    // Cache demux results by mediaRef so same media is demuxed once
    const demuxCache = new Map<string, { track: ReturnType<typeof Object.assign>, fileBytes: ArrayBuffer }>();

    for (const track of timeline.tracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (clip.mediaType !== "video" && clip.mediaType !== "image") continue;
        clipById.set(clip.id, clip);

        if (clip.mediaType === "video") {
          let cached = demuxCache.get(clip.mediaRef);
          if (!cached) {
            const blob = await media.open(clip.mediaRef);
            const fileBytes = await blob.arrayBuffer();
            const demux = await demuxMp4(new Blob([fileBytes]));
            if (!demux.video) throw new Error(`no video track in mediaRef: ${clip.mediaRef}`);
            cached = { track: demux.video, fileBytes };
            demuxCache.set(clip.mediaRef, cached);
          }
          const chunks = buildVideoChunks(cached.track, cached.fileBytes);
          const mgr = await VideoDecodeManager.create(cached.track, chunks);
          const natSize: Size = { width: cached.track.codedWidth, height: cached.track.codedHeight };
          sources.set(clip.id, { type: "video", mgr, natSize });
          sourceSizes.set(clip.mediaRef, natSize);
        } else {
          // image
          const blob = await media.open(clip.mediaRef);
          const bytes = await blob.arrayBuffer();
          const src = await ImageSource.create(bytes);
          const natSize = src.size();
          sources.set(clip.id, { type: "image", src, natSize });
          sourceSizes.set(clip.mediaRef, natSize);
        }
      }
    }

    return new SourceCoordinator(timeline, sources, clipById, sourceSizes);
  }

  sourceSizes(): Map<string, Size> {
    return this._sourceSizes;
  }

  async layersForScrub(frame: number): Promise<{ layers: CompositeLayer[]; cleanup: () => void }> {
    const plan = buildRenderPlan(this.timeline, frame, this._sourceSizes);
    const layers: CompositeLayer[] = [];
    const owned: Array<{ mgr: VideoDecodeManager; vf: VideoFrame }> = [];

    for (const layer of plan.layers) {
      const entry = this.sources.get(layer.clipId);
      if (!entry) continue;

      const clip = this.clipById.get(layer.clipId);
      if (!clip) continue;

      if (entry.type === "video") {
        const srcUs = clipSourceMicros(clip, frame, this.timeline.fps);
        const vf = await entry.mgr.frameAtMicros(srcUs);
        owned.push({ mgr: entry.mgr, vf });
        layers.push({ frame: vf, transform: layer.transform, opacity: layer.opacity, crop: layer.crop });
      } else {
        layers.push({ frame: entry.src.frame(), transform: layer.transform, opacity: layer.opacity, crop: layer.crop });
      }
    }

    const cleanup = () => {
      for (const { mgr, vf } of owned) {
        try { mgr.closeFrame(vf); } catch { /* already closed */ }
      }
    };

    return { layers, cleanup };
  }

  async seekAllTo(frame: number): Promise<void> {
    for (const [clipId, entry] of this.sources) {
      if (entry.type !== "video") continue;
      const clip = this.clipById.get(clipId);
      if (!clip) continue;
      const srcUs = clipSourceMicros(clip, frame, this.timeline.fps);
      await entry.mgr.seekTo(srcUs);
    }
  }

  pumpAll(): void {
    for (const entry of this.sources.values()) {
      if (entry.type === "video") entry.mgr.pump();
    }
  }

  layersForPlayback(frame: number): CompositeLayer[] {
    const plan = buildRenderPlan(this.timeline, frame, this._sourceSizes);
    const layers: CompositeLayer[] = [];

    for (const layer of plan.layers) {
      const entry = this.sources.get(layer.clipId);
      if (!entry) continue;

      const clip = this.clipById.get(layer.clipId);
      if (!clip) continue;

      if (entry.type === "video") {
        const srcUs = clipSourceMicros(clip, frame, this.timeline.fps);
        const vf = entry.mgr.frameForMicros(srcUs);
        if (vf === undefined) continue; // skip if not buffered yet
        layers.push({ frame: vf, transform: layer.transform, opacity: layer.opacity, crop: layer.crop });
      } else {
        layers.push({ frame: entry.src.frame(), transform: layer.transform, opacity: layer.opacity, crop: layer.crop });
      }
    }

    return layers;
  }

  dispose(): void {
    for (const entry of this.sources.values()) {
      if (entry.type === "video") entry.mgr.dispose();
      else entry.src.dispose();
    }
    this.sources.clear();
  }
}
