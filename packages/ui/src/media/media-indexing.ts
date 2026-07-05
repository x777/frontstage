// Renderer-resident background visual-search indexer (M12C T3) — the GenerationService/
// TranscriptionService pattern applied to Search/SearchIndexCoordinator.swift's queue/sweep
// behavior. Sweeps the library for video/image entries lacking a current .embed, taps sampled
// frames through a DOM canvas (production FrameTap below), runs T1's pure sampler/codec, and
// writes the result back through the same writeDerived/patchEntry flow transcripts use.

import type { MediaByteSource } from "@frontstage/engine";
import type { EmbeddingModelInfo } from "@frontstage/ai";
import { canTranscribe } from "@frontstage/ai";
import type { EmbeddingHeader, EmbeddingRow, MediaManifestEntry, TranscriptionResult } from "@frontstage/core";
import {
  assignShots,
  candidateTimes,
  decodeEmbeddings,
  embeddingRelativePath,
  encodeEmbeddings,
  gridDiff,
  lumaGrid8x8,
  SCENE_DIFF_THRESHOLD,
} from "@frontstage/core";

const TAP_SIZE = 256;

export type MissingModel = "embedding" | "transcription";

export type IndexStatus =
  | { kind: "idle" }
  | { kind: "indexing"; done: number; total: number }
  | { kind: "waiting-model"; missing: MissingModel[] };

export type FrameTap = (
  entry: MediaManifestEntry,
  blobUrl: string,
  times: number[],
) => AsyncIterable<{ timeSec: number; rgba: Uint8ClampedArray; width: 256; height: 256 }>;

export interface MediaBlobHandle {
  url: string;
  byteLength: number;
  release: () => void;
}

export type OpenMedia = (entry: MediaManifestEntry) => Promise<MediaBlobHandle>;

export interface MediaIndexingHost {
  entries(): MediaManifestEntry[];
  patchEntry(id: string, patch: Partial<MediaManifestEntry>): void;
  writeDerived(relativePath: string, bytes: Uint8Array): void;
  readDerived(relativePath: string): Promise<Uint8Array | null>;
}

export interface MediaIndexingEmbedding {
  readonly state: "idle" | "downloading" | "ready" | "failed";
  readonly info: EmbeddingModelInfo;
  embedImage(rgba: Uint8ClampedArray, width: number, height: number): Promise<Float32Array>;
}

// The background transcript step's write path (M14A T3) — deliberately minimal: the sweep only
// ever needs the forceLocal call, never TranscriptionService's full surface (caching/dedupe/status
// already live inside it and are reused as-is).
export interface MediaIndexingTranscription {
  transcribe(mediaRef: string, opts: { forceLocal: true }): Promise<TranscriptionResult>;
}

export interface MediaIndexingLocalAsr {
  readonly state: "idle" | "downloading" | "ready" | "failed";
}

export interface MediaIndexingDeps {
  library: MediaIndexingHost;
  embedding: MediaIndexingEmbedding;
  sampleFrames: FrameTap;
  samplerVersion: string;
  openMedia: OpenMedia;
  // Background transcription (M14A T3). Both absent = pre-M14A behavior: no entry is ever
  // considered to "want" transcript work, so audio-only entries stay unqueued as before.
  transcription?: MediaIndexingTranscription;
  localAsr?: MediaIndexingLocalAsr;
  // How often to recheck a not-ready model while queued work is waiting-model (default 500ms).
  readyPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Swift's SearchIndexCoordinator.wantsTranscript: audio, or video known to carry an audio track. */
function wantsTranscript(entry: MediaManifestEntry): boolean {
  return canTranscribe(entry);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface QueueItem {
  id: string;
  visual: boolean;
  transcript: boolean;
}

export class MediaIndexingService {
  private readonly deps: MediaIndexingDeps;
  private readonly sleep: (ms: number) => Promise<void>;
  private disposed = false;
  private queue: QueueItem[] = [];
  private processingId: string | null = null;
  private total = 0;
  private done = 0;
  private worker: Promise<void> | null = null;
  private watchingEmbeddingReady = false;
  private watchingAsrReady = false;
  private sweeping = false;
  private resweepRequested = false;
  private _status: IndexStatus = { kind: "idle" };
  private statusListeners = new Set<(s: IndexStatus) => void>();

  constructor(deps: MediaIndexingDeps) {
    this.deps = deps;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  get status(): IndexStatus {
    return this._status;
  }

  onStatus(cb: (s: IndexStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** Project open, or re-called after a library emission / an external ensureReady() resolves. */
  start(): void {
    if (this.disposed) return;
    void this.sweep(this.deps.library.entries());
  }

  /** Forces a single entry back into the queue if it's actually stale — skips a full sweep. */
  reindexIfStale(entryId: string): void {
    if (this.disposed) return;
    const entry = this.deps.library.entries().find((e) => e.id === entryId);
    if (!entry) return;
    void this.needsIndex(entry).then((work) => {
      if (this.disposed || !work) return;
      if (this.queue.some((w) => w.id === entryId) || entryId === this.processingId) return;
      this.queue.push({ id: entryId, ...work });
      this.total += 1;
      this.publishStatus();
      this.ensureWorker();
    });
  }

  /** Cache-only read for the search tool (T4): never indexes, just decodes the cached rows. */
  async cachedEmbeddings(mediaRef: string): Promise<EmbeddingRow[] | null> {
    const entry = this.deps.library.entries().find((e) => e.id === mediaRef);
    if (!entry?.embeddingPath) return null;
    const bytes = await this.deps.library.readDerived(entry.embeddingPath);
    if (!bytes) return null;
    return decodeEmbeddings(bytes)?.rows ?? null;
  }

  /** Stops the worker between entries/frames; any in-flight entry's result is discarded, not written. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
    this.processingId = null;
    this.total = 0;
    this.done = 0;
    this.publishStatus();
  }

  private async sweep(snapshot: MediaManifestEntry[]): Promise<void> {
    if (this.disposed) return;
    if (this.sweeping) {
      this.resweepRequested = true;
      return;
    }
    this.sweeping = true;
    try {
      do {
        this.resweepRequested = false;
        // Video/image (visual work) + audio (transcript-only work) — needsIndex resolves per-entry
        // which of the two, if either, is actually outstanding.
        const candidates = snapshot.filter((e) => e.type === "video" || e.type === "image" || e.type === "audio");
        const newlyStale: QueueItem[] = [];
        for (const entry of candidates) {
          if (this.disposed) return;
          if (this.queue.some((w) => w.id === entry.id) || entry.id === this.processingId) continue;
          const work = await this.needsIndex(entry);
          if (work) newlyStale.push({ id: entry.id, ...work });
        }
        if (this.disposed) return;
        if (newlyStale.length > 0) {
          this.queue.push(...newlyStale);
          this.total += newlyStale.length;
          this.publishStatus();
        }
      } while (this.resweepRequested && !this.disposed);
    } finally {
      this.sweeping = false;
    }
    this.ensureWorker();
  }

  private async needsIndex(entry: MediaManifestEntry): Promise<{ visual: boolean; transcript: boolean } | null> {
    const visual = await this.needsVisual(entry);
    const transcript = this.needsTranscript(entry);
    return visual || transcript ? { visual, transcript } : null;
  }

  private async needsVisual(entry: MediaManifestEntry): Promise<boolean> {
    if (entry.type !== "video" && entry.type !== "image") return false;
    if (!entry.embeddingPath) return true;

    const cached = await this.deps.library.readDerived(entry.embeddingPath);
    if (!cached) return true;
    const decoded = decodeEmbeddings(cached);
    if (!decoded) return true;

    const { header } = decoded;
    const info = this.deps.embedding.info;
    if (header.model !== info.model || header.modelVersion !== info.modelVersion || header.samplerVersion !== this.deps.samplerVersion) {
      return true;
    }

    const handle = await this.deps.openMedia(entry);
    handle.release();
    return header.sourceBytes !== handle.byteLength;
  }

  // The cheap check (entry.transcriptPath presence) over a cachedTranscript() read: no disk-cache
  // I/O just to decide whether an entry belongs in the queue. transcribe() itself re-validates the
  // cache (and falls through to a fresh transcription) if the path turns out to be stale/corrupt.
  private needsTranscript(entry: MediaManifestEntry): boolean {
    if (!this.deps.transcription) return false;
    if (!wantsTranscript(entry)) return false;
    return !entry.transcriptPath;
  }

  private ensureWorker(): void {
    if (this.disposed) return;
    // Armed even while a worker is mid-run: an entry queued during the run may be skip-processed
    // (its model not ready) before the worker exits — the watcher is what re-sweeps it later.
    this.armReadyWatchers();
    if (this.worker) return;
    if (this.queue.length === 0) {
      this.total = 0;
      this.done = 0;
      this.publishStatus();
      return;
    }
    if (!this.canMakeProgress()) {
      this.publishStatus();
      return;
    }
    this.worker = this.runWorker().finally(() => {
      this.worker = null;
      this.ensureWorker();
    });
  }

  // A model only counts as "missing" when the current queue actually has work that needs it — an
  // ASR download gate never blocks a queue that's all video/image, and vice versa.
  private missingModels(): MissingModel[] {
    const missing: MissingModel[] = [];
    if (this.queue.some((w) => w.visual) && this.deps.embedding.state !== "ready") missing.push("embedding");
    if (this.queue.some((w) => w.transcript) && this.deps.localAsr?.state !== "ready") missing.push("transcription");
    return missing;
  }

  private canMakeProgress(): boolean {
    if (this.queue.some((w) => w.visual) && this.deps.embedding.state === "ready") return true;
    if (this.queue.some((w) => w.transcript) && this.deps.localAsr?.state === "ready") return true;
    return false;
  }

  // Polls (not event-driven — same shape as M12C's single-model watcher) until its model reports
  // ready or the service is disposed. NOT bounded by queue.length: by the time a model goes ready,
  // this pass may already have popped (and skip-processed) every entry that needed it — start()
  // re-sweeps the library from scratch to pick those back up, mirroring the embedding-model hook.
  private armReadyWatchers(): void {
    const missing = this.missingModels();
    if (missing.includes("embedding") && !this.watchingEmbeddingReady) {
      this.watchingEmbeddingReady = true;
      void this.waitUntilModelReady(() => this.deps.embedding.state).then(() => {
        this.watchingEmbeddingReady = false;
        if (!this.disposed) this.start();
      });
    }
    if (missing.includes("transcription") && !this.watchingAsrReady) {
      this.watchingAsrReady = true;
      void this.waitUntilModelReady(() => this.deps.localAsr?.state ?? "idle").then(() => {
        this.watchingAsrReady = false;
        if (!this.disposed) this.start();
      });
    }
  }

  private async waitUntilModelReady(stateOf: () => "idle" | "downloading" | "ready" | "failed"): Promise<void> {
    while (!this.disposed && stateOf() !== "ready") {
      await this.sleep(this.deps.readyPollMs ?? 500);
    }
  }

  private async runWorker(): Promise<void> {
    while (!this.disposed && this.canMakeProgress()) {
      const work = this.queue.shift();
      if (work === undefined) break;
      this.processingId = work.id;
      const entry = this.deps.library.entries().find((e) => e.id === work.id);
      if (entry) {
        try {
          await this.indexOne(entry, work);
        } catch (err) {
          console.warn(`media-indexing: failed to index "${entry.name}" (${work.id})`, err);
        }
      }
      this.processingId = null;
      if (this.disposed) return;
      this.done += 1;
      this.publishStatus();
    }
  }

  // Runs whichever of the two steps this entry both needs AND has a ready model for right now; the
  // other is silently left outstanding for the ready-watcher's later resweep. Swift gates its whole
  // sweep on one bundled (CoreML) model — TS gates per-step, since both models here are
  // independently download-gated and shouldn't block each other's progress.
  private async indexOne(entry: MediaManifestEntry, work: QueueItem): Promise<void> {
    if (work.visual && this.deps.embedding.state === "ready") {
      await this.indexVisual(entry);
    }
    if (work.transcript && this.deps.transcription && this.deps.localAsr?.state === "ready") {
      await this.deps.transcription.transcribe(entry.id, { forceLocal: true });
    }
  }

  private async indexVisual(entry: MediaManifestEntry): Promise<void> {
    const handle = await this.deps.openMedia(entry);
    try {
      const rows = entry.type === "image" ? await this.sampleImage(entry, handle.url) : await this.sampleVideo(entry, handle.url);
      if (this.disposed) return;

      const info = this.deps.embedding.info;
      const header: EmbeddingHeader = {
        model: info.model,
        modelVersion: info.modelVersion,
        samplerVersion: this.deps.samplerVersion,
        dim: info.dim,
        count: rows.length,
        sourceBytes: handle.byteLength,
      };
      const bytes = encodeEmbeddings(header, rows);
      const relativePath = embeddingRelativePath(entry.id);
      this.deps.library.writeDerived(relativePath, bytes);
      this.deps.library.patchEntry(entry.id, { embeddingPath: relativePath });
    } finally {
      handle.release();
    }
  }

  // Stills skip the sampler: one embedding, zero-length shot range (Swift's VisualIndexer.indexImage).
  private async sampleImage(entry: MediaManifestEntry, blobUrl: string): Promise<EmbeddingRow[]> {
    for await (const frame of this.deps.sampleFrames(entry, blobUrl, [0])) {
      const vector = await this.deps.embedding.embedImage(frame.rgba, frame.width, frame.height);
      return [{ time: 0, shotStart: 0, shotEnd: 0, vector }];
    }
    return [];
  }

  private async sampleVideo(entry: MediaManifestEntry, blobUrl: string): Promise<EmbeddingRow[]> {
    const longEdge = Math.max(entry.sourceWidth ?? 0, entry.sourceHeight ?? 0);
    const times = candidateTimes({ durationSec: entry.duration, longEdgePx: longEdge });
    if (times.length === 0) return [];

    const frames: { timeSec: number; rgba: Uint8ClampedArray; width: number; height: number }[] = [];
    const grids: Float32Array[] = [];
    for await (const frame of this.deps.sampleFrames(entry, blobUrl, times)) {
      if (this.disposed) return [];
      frames.push(frame);
      grids.push(lumaGrid8x8(frame.rgba, frame.width, frame.height));
    }

    const isSceneChange = (i: number) => i > 0 && gridDiff(grids[i - 1]!, grids[i]!) > SCENE_DIFF_THRESHOLD;
    const shots = assignShots(
      frames.map((f) => f.timeSec),
      isSceneChange,
    );
    // The trailing shot's rows carry a placeholder shotEnd === shotStart (assignShots has no
    // duration param) — patch every row belonging to that shot to the asset's real duration.
    const maxShotStart = shots.reduce((m, s) => Math.max(m, s.shotStart), 0);
    const framesByTime = new Map(frames.map((f) => [f.timeSec, f]));

    const rows: EmbeddingRow[] = [];
    for (const shot of shots) {
      if (this.disposed) return rows;
      const frame = framesByTime.get(shot.timeSec);
      if (!frame) continue;
      const vector = await this.deps.embedding.embedImage(frame.rgba, frame.width, frame.height);
      const shotEnd = shot.shotStart === maxShotStart ? entry.duration : shot.shotEnd;
      rows.push({ time: shot.timeSec, shotStart: shot.shotStart, shotEnd, vector });
    }
    return rows;
  }

  private publishStatus(): void {
    this._status = this.computeStatus();
    for (const cb of [...this.statusListeners]) cb(this._status);
  }

  private computeStatus(): IndexStatus {
    if (this.total === 0) return { kind: "idle" };
    // Only report waiting-model while there's still-queued work truly blocked on a model — an
    // empty queue with total>0 is the tail tick of the last entry completing (done===total),
    // not a stall; ensureWorker's next call resets total/done to 0 and republishes idle.
    if (this.queue.length > 0 && !this.canMakeProgress()) {
      return { kind: "waiting-model", missing: this.missingModels() };
    }
    return { kind: "indexing", done: this.done, total: this.total };
  }
}

/** Relays status across a MediaIndexingService dispose/recreate (project reopen) via a stable ref. */
export class IndexingStatusRelay {
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private service: MediaIndexingService;

  constructor(service: MediaIndexingService) {
    this.service = service;
    this.attach();
  }

  private attach(): void {
    this.unsubscribe = this.service.onStatus(() => {
      for (const cb of this.listeners) cb();
    });
  }

  rewire(service: MediaIndexingService): void {
    this.unsubscribe?.();
    this.service = service;
    this.attach();
    for (const cb of this.listeners) cb();
  }

  getStatus = (): IndexStatus => this.service.status;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
}

// ── Production DOM seams (hidden <video>/<img> + canvas squash-resize) ──────────────────────

export function createDomOpenMedia(byteSource: MediaByteSource): OpenMedia {
  return async (entry) => {
    const blob = await byteSource.open(entry.id);
    const url = URL.createObjectURL(blob);
    return { url, byteLength: blob.size, release: () => URL.revokeObjectURL(url) };
  };
}

function onceEvent(el: HTMLMediaElement | HTMLImageElement, okEvent: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener(okEvent, onOk);
      el.removeEventListener("error", onErr);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`${okEvent} failed`));
    };
    el.addEventListener(okEvent, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("seek failed"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
    video.currentTime = t;
  });
}

// Squash-resize (no aspect crop) to the fixed tap size — matches Swift's manifest.imageSize contract.
function drawSquashed(source: CanvasImageSource): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = TAP_SIZE;
  canvas.height = TAP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("media-indexing: no 2d canvas context");
  ctx.drawImage(source, 0, 0, TAP_SIZE, TAP_SIZE);
  return ctx.getImageData(0, 0, TAP_SIZE, TAP_SIZE).data;
}

async function* tapImage(blobUrl: string, times: number[]): AsyncGenerator<{ timeSec: number; rgba: Uint8ClampedArray; width: 256; height: 256 }> {
  const img = new Image();
  img.src = blobUrl;
  await onceEvent(img, "load");
  yield { timeSec: times[0] ?? 0, rgba: drawSquashed(img), width: TAP_SIZE, height: TAP_SIZE };
}

async function* tapVideo(blobUrl: string, times: number[]): AsyncGenerator<{ timeSec: number; rgba: Uint8ClampedArray; width: 256; height: 256 }> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.src = blobUrl;
  try {
    await onceEvent(video, "loadeddata");
    for (const t of times) {
      await seekTo(video, t);
      yield { timeSec: t, rgba: drawSquashed(video), width: TAP_SIZE, height: TAP_SIZE };
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export function createDomFrameTap(): FrameTap {
  return (entry, blobUrl, times) => (entry.type === "image" ? tapImage(blobUrl, times) : tapVideo(blobUrl, times));
}
