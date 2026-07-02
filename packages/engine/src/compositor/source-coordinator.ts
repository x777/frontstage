import { affineTransform, applyTextLayerAnim, buildRenderPlan, defaultCrop, frameToSeconds, type Clip, type Size, type Timeline } from "@palmier/core";
import { demuxMp4 } from "../demux/mp4-demuxer.js";
import { buildVideoChunks, VideoDecodeManager } from "../decode/video-decoder.js";
import { ImageSource } from "../media/image-source.js";
import type { MediaByteSource } from "../media/media-source.js";
import type { CompositeLayer } from "../render/composite-layer.js";
import { TextRasterizer } from "../render/text-rasterizer.js";

export function clipSourceMicros(clip: Clip, frame: number, fps: number): number {
  return Math.round(frameToSeconds(clip.trimStartFrame + (frame - clip.startFrame) * clip.speed, fps) * 1e6);
}

interface VideoEntry {
  type: "video";
  mgr: VideoDecodeManager;
  natSize: Size;
  mediaRef: string;
}

interface ImageEntry {
  type: "image";
  src: ImageSource;
  natSize: Size;
  mediaRef: string;
}

type SourceEntry = VideoEntry | ImageEntry;

export class SourceCoordinator {
  private readonly textRasterizer: TextRasterizer;

  private constructor(
    private timeline: Timeline,
    private readonly sources: Map<string, SourceEntry>,
    private readonly clipById: Map<string, Clip>,
    private readonly _sourceSizes: Map<string, Size>,
    private readonly demuxCache: Map<string, { track: NonNullable<Awaited<ReturnType<typeof demuxMp4>>["video"]>; fileBytes: ArrayBuffer }>,
    private readonly media: MediaByteSource,
    private readonly failedRefs: Set<string>,
  ) {
    this.textRasterizer = new TextRasterizer();
  }

  static async create(timeline: Timeline, media: MediaByteSource): Promise<SourceCoordinator> {
    const sources = new Map<string, SourceEntry>();
    const clipById = new Map<string, Clip>();
    const sourceSizes = new Map<string, Size>();
    const failedRefs = new Set<string>();

    type DemuxVideo = NonNullable<Awaited<ReturnType<typeof demuxMp4>>["video"]>;
    const demuxCache = new Map<string, { track: DemuxVideo; fileBytes: ArrayBuffer }>();

    try {
      for (const track of timeline.tracks) {
        if (track.hidden) continue;
        for (const clip of track.clips) {
          if (clip.mediaType !== "video" && clip.mediaType !== "image") continue;
          clipById.set(clip.id, clip);
          await SourceCoordinator._tryAddClipSource(clip, media, demuxCache, sources, sourceSizes, failedRefs);
        }
      }
    } catch (e) {
      for (const entry of sources.values()) {
        if (entry.type === "video") entry.mgr.dispose();
        else entry.src.dispose();
      }
      throw e;
    }

    return new SourceCoordinator(timeline, sources, clipById, sourceSizes, demuxCache, media, failedRefs);
  }

  // Missing media for one clip must not sink the whole load — skip it, warn once, and let
  // reconcile() retry (a generation placeholder's real file lands after the initial load).
  private static async _tryAddClipSource(
    clip: Clip,
    media: MediaByteSource,
    demuxCache: Map<string, { track: NonNullable<Awaited<ReturnType<typeof demuxMp4>>["video"]>; fileBytes: ArrayBuffer }>,
    sources: Map<string, SourceEntry>,
    sourceSizes: Map<string, Size>,
    failedRefs: Set<string>,
  ): Promise<void> {
    try {
      await SourceCoordinator._addClipSource(clip, media, demuxCache, sources, sourceSizes);
      failedRefs.delete(clip.mediaRef);
    } catch (e) {
      if (!failedRefs.has(clip.mediaRef)) {
        console.warn(`compositor: skipping clip ${clip.id} (media open failed for ${clip.mediaRef}):`, e);
      }
      failedRefs.add(clip.mediaRef);
    }
  }

  private static async _addClipSource(
    clip: Clip,
    media: MediaByteSource,
    demuxCache: Map<string, { track: NonNullable<Awaited<ReturnType<typeof demuxMp4>>["video"]>; fileBytes: ArrayBuffer }>,
    sources: Map<string, SourceEntry>,
    sourceSizes: Map<string, Size>,
  ): Promise<void> {
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
      sources.set(clip.id, { type: "video", mgr, natSize, mediaRef: clip.mediaRef });
      sourceSizes.set(clip.mediaRef, natSize);
    } else {
      const blob = await media.open(clip.mediaRef);
      const bytes = await blob.arrayBuffer();
      const src = await ImageSource.create(bytes);
      const natSize = src.size();
      sources.set(clip.id, { type: "image", src, natSize, mediaRef: clip.mediaRef });
      sourceSizes.set(clip.mediaRef, natSize);
    }
  }

  async reconcile(timeline: Timeline): Promise<void> {
    const newClips = new Map<string, Clip>();
    for (const track of timeline.tracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (clip.mediaType !== "video" && clip.mediaType !== "image") continue;
        newClips.set(clip.id, clip);
      }
    }

    // Collect clips to remove, then dispose + delete in a second pass
    const toRemove: string[] = [];
    for (const [clipId] of this.sources) {
      if (!newClips.has(clipId)) toRemove.push(clipId);
    }
    for (const clipId of toRemove) {
      const entry = this.sources.get(clipId)!;
      if (entry.type === "video") entry.mgr.dispose();
      else entry.src.dispose();
      this.sources.delete(clipId);
      this.clipById.delete(clipId);
    }

    // Add/rebuild sources for new or media-replaced clips
    for (const [clipId, clip] of newClips) {
      const existing = this.sources.get(clipId);
      if (!existing) {
        this.clipById.set(clipId, clip);
        await SourceCoordinator._tryAddClipSource(clip, this.media, this.demuxCache, this.sources, this._sourceSizes, this.failedRefs);
      } else if (existing.mediaRef !== clip.mediaRef) {
        // Same clipId but mediaRef changed (media replace) — dispose old and rebuild
        if (existing.type === "video") existing.mgr.dispose();
        else existing.src.dispose();
        this.sources.delete(clipId);
        this.clipById.set(clipId, clip);
        await SourceCoordinator._tryAddClipSource(clip, this.media, this.demuxCache, this.sources, this._sourceSizes, this.failedRefs);
      } else {
        // mediaRef unchanged — keep; update clip metadata in case trim/speed changed
        this.clipById.set(clipId, clip);
      }
    }

    this.timeline = timeline;
  }

  sourceSizes(): Map<string, Size> {
    return this._sourceSizes;
  }

  async layersForScrub(frame: number): Promise<{ layers: CompositeLayer[]; cleanup: () => void }> {
    const plan = buildRenderPlan(this.timeline, frame, this._sourceSizes);
    const renderSize: Size = { width: this.timeline.width, height: this.timeline.height };
    const tagged: Array<{ layer: CompositeLayer; zIndex: number }> = [];
    const owned: Array<{ mgr: VideoDecodeManager; vf: VideoFrame }> = [];

    for (const layer of plan.layers) {
      const entry = this.sources.get(layer.clipId);
      if (!entry) continue;

      const clip = this.clipById.get(layer.clipId);
      if (!clip) continue;

      if (entry.type === "video") {
        try {
          const srcUs = clipSourceMicros(clip, frame, this.timeline.fps);
          const vf = await entry.mgr.frameAtMicros(srcUs);
          owned.push({ mgr: entry.mgr, vf });
          tagged.push({ layer: { frame: vf, transform: layer.transform, opacity: layer.opacity, crop: layer.crop, effects: layer.effects, blendMode: layer.blendMode }, zIndex: layer.zIndex });
        } catch (e) {
          console.warn(`compositor: skipping clip ${layer.clipId} (decode failed):`, e);
        }
      } else {
        tagged.push({ layer: { frame: entry.src.frame(), transform: layer.transform, opacity: layer.opacity, crop: layer.crop, effects: layer.effects, blendMode: layer.blendMode }, zIndex: layer.zIndex });
      }
    }

    for (const textLayer of plan.textLayers) {
      const { transform, opacity } = applyTextLayerAnim(textLayer);
      const tf = affineTransform(transform, renderSize, renderSize);
      tagged.push({
        layer: { frame: this.textRasterizer.rasterize(textLayer, renderSize), transform: tf, opacity, crop: defaultCrop() },
        zIndex: textLayer.zIndex,
      });
    }

    tagged.sort((a, b) => a.zIndex - b.zIndex);
    const layers = tagged.map(t => t.layer);

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

  async primeAt(frame: number): Promise<void> {
    for (const [clipId, entry] of this.sources) {
      if (entry.type !== "video") continue;
      const clip = this.clipById.get(clipId);
      if (!clip) continue;
      const srcUs = clipSourceMicros(clip, frame, this.timeline.fps);
      await entry.mgr.primeTo(srcUs);
    }
  }

  pumpAll(): void {
    for (const entry of this.sources.values()) {
      if (entry.type === "video") entry.mgr.pump();
    }
  }

  layersForPlayback(frame: number): CompositeLayer[] {
    const plan = buildRenderPlan(this.timeline, frame, this._sourceSizes);
    const renderSize: Size = { width: this.timeline.width, height: this.timeline.height };
    const tagged: Array<{ layer: CompositeLayer; zIndex: number }> = [];

    for (const layer of plan.layers) {
      const entry = this.sources.get(layer.clipId);
      if (!entry) continue;

      const clip = this.clipById.get(layer.clipId);
      if (!clip) continue;

      if (entry.type === "video") {
        const srcUs = clipSourceMicros(clip, frame, this.timeline.fps);
        const vf = entry.mgr.frameForMicros(srcUs);
        if (vf === undefined) continue; // skip if not buffered yet
        tagged.push({ layer: { frame: vf, transform: layer.transform, opacity: layer.opacity, crop: layer.crop, effects: layer.effects, blendMode: layer.blendMode }, zIndex: layer.zIndex });
      } else {
        tagged.push({ layer: { frame: entry.src.frame(), transform: layer.transform, opacity: layer.opacity, crop: layer.crop, effects: layer.effects, blendMode: layer.blendMode }, zIndex: layer.zIndex });
      }
    }

    for (const textLayer of plan.textLayers) {
      const { transform, opacity } = applyTextLayerAnim(textLayer);
      const tf = affineTransform(transform, renderSize, renderSize);
      tagged.push({
        layer: { frame: this.textRasterizer.rasterize(textLayer, renderSize), transform: tf, opacity, crop: defaultCrop() },
        zIndex: textLayer.zIndex,
      });
    }

    tagged.sort((a, b) => a.zIndex - b.zIndex);
    return tagged.map(t => t.layer);
  }

  clearPumpBuffers(): void {
    for (const entry of this.sources.values()) {
      if (entry.type === "video") entry.mgr.clearPumpBuffer();
    }
  }

  openFrameCount(): number {
    let count = 0;
    for (const entry of this.sources.values()) {
      if (entry.type === "video") count += entry.mgr.openFrameCount();
    }
    return count;
  }

  dispose(): void {
    for (const entry of this.sources.values()) {
      if (entry.type === "video") entry.mgr.dispose();
      else entry.src.dispose();
    }
    this.sources.clear();
    this.textRasterizer.dispose();
  }
}
