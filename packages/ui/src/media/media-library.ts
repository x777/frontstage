import { clipTypeFromFileExtension, serializeGenerationStatus, makeMediaFolder, buildFolderIndex, canMoveFolder, collectFolderCascade, createImportPlaceholderEntry } from "@palmier/core";
import type { ClipType, MediaFolder, MediaManifest, MediaManifestEntry } from "@palmier/core";
import type { MediaGateway } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import { extensionForImportMime, importTypeForExtension } from "@palmier/ai";

interface LibrarySnapshot {
  entries: MediaManifestEntry[];
  folders: MediaFolder[];
}

export class MediaLibrary {
  // in-memory bytes keyed by relativePath
  private _bytes = new Map<string, Uint8Array>();
  // relativePaths whose bytes are persisted (no longer pending)
  private _persisted = new Set<string>();
  private thumbnails = new Map<string, string>();
  private _entries: MediaManifestEntry[] = [];
  private _folders: MediaFolder[] = [];
  private _snapshot: LibrarySnapshot = { entries: [], folders: [] };
  private _manifest: MediaManifest = { version: 2, entries: [], folders: [] };
  private _manifestVersion = 2;
  private listeners = new Set<() => void>();
  private _gateway: MediaGateway | null = null;

  getSnapshot(): LibrarySnapshot {
    return this._snapshot;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const entries = [...this._entries];
    const folders = [...this._folders];
    this._snapshot = { entries, folders };
    this._manifest = { version: this._manifestVersion, entries, folders };
    for (const l of this.listeners) l();
  }

  thumbnail(id: string): string | undefined {
    return this.thumbnails.get(id);
  }

  entry(id: string): MediaManifestEntry | undefined {
    return this._entries.find((e) => e.id === id);
  }

  getManifest(): MediaManifest {
    return this._manifest;
  }

  loadManifest(manifest: MediaManifest, gateway: MediaGateway | null): void {
    this._entries = manifest.entries;
    this._folders = manifest.folders;
    this._manifestVersion = manifest.version;
    this._bytes.clear();
    this._persisted.clear();
    this._gateway = gateway;
    this.emit();
  }

  pendingMedia(): Map<string, Uint8Array> {
    const pending = new Map<string, Uint8Array>();
    for (const [relativePath, bytes] of this._bytes) {
      if (!this._persisted.has(relativePath)) {
        pending.set(relativePath, bytes);
      }
    }
    return pending;
  }

  markMediaPersisted(relativePaths: string[]): void {
    for (const p of relativePaths) {
      this._persisted.add(p);
    }
  }

  setGateway(gateway: MediaGateway | null): void {
    this._gateway = gateway;
  }

  // In-memory bytes for an entry, if still held (unsaved / pending-persist) — no gateway I/O.
  bytesFor(entry: MediaManifestEntry): Uint8Array | undefined {
    return entry.source.kind === "project" ? this._bytes.get(entry.source.relativePath) : undefined;
  }

  // Gateway fallback for bytesFor misses (already-persisted media, not held in memory).
  async readMedia(relativePath: string): Promise<Uint8Array> {
    if (!this._gateway) throw new Error("no gateway configured");
    return this._gateway.readMedia(relativePath);
  }

  // Derived-data write (transcripts, etc.): rides the same _bytes/pending-persist flow as real
  // media — the project save picks it up like any other unpersisted path.
  writeDerived(relativePath: string, bytes: Uint8Array): void {
    this._bytes.set(relativePath, bytes);
    this.emit();
  }

  // In-memory bytes if still held, else the gateway; null (not a throw) on either miss — callers
  // treat a miss as "not cached yet", not an error.
  async readDerived(relativePath: string): Promise<Uint8Array | null> {
    const bytes = this._bytes.get(relativePath);
    if (bytes) return bytes;
    if (!this._gateway) return null;
    try {
      return await this._gateway.readMedia(relativePath);
    } catch {
      return null;
    }
  }

  // .cube LUT project persistence (M14C T2, the Swift LUTLoader.store pattern): stores bytes at
  // luts/<filename> via the same writeDerived/pending-persist flow as transcripts, with a
  // unique-suffix on a NAME collision (checked against both pending bytes and the saved gateway —
  // content is not compared, only the name). Returns the stored project-relative path.
  async storeLut(filename: string, bytes: Uint8Array): Promise<string> {
    const relativePath = await this.reserveLutPath(filename);
    this.writeDerived(relativePath, bytes);
    return relativePath;
  }

  private async lutPathTaken(relativePath: string): Promise<boolean> {
    if (this._bytes.has(relativePath)) return true;
    if (!this._gateway) return false;
    try {
      return await this._gateway.hasMedia(relativePath);
    } catch {
      return false;
    }
  }

  private async reserveLutPath(filename: string): Promise<string> {
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    let candidate = `luts/${filename}`;
    let n = 2;
    while (await this.lutPathTaken(candidate)) {
      candidate = `luts/${base}-${n}${ext}`;
      n++;
    }
    return candidate;
  }

  get byteSource(): MediaByteSource {
    return {
      open: async (ref: string) => {
        // ref is a clip's mediaRef = entry id; resolve id → entry → relativePath → bytes
        const e = this._entries.find((entry) => entry.id === ref);
        if (!e) throw new Error("media not found: " + ref);
        if (e.source.kind !== "project") throw new Error("non-project source for: " + ref);
        const relativePath = e.source.relativePath;
        const bytes = this._bytes.get(relativePath);
        if (bytes) return new Blob([bytes as BlobPart]);
        if (!this._gateway) throw new Error("no gateway and no in-memory bytes for: " + relativePath);
        const gatewayBytes = await this._gateway.readMedia(relativePath);
        return new Blob([gatewayBytes as BlobPart]);
      },
    };
  }

  async seed(id: string, url: string, entry: MediaManifestEntry): Promise<void> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (entry.source.kind !== "project") throw new Error("seed expects project source");
    this._bytes.set(entry.source.relativePath, bytes);
    this._entries.push(entry);
    this.emit();
  }

  addEntry(entry: MediaManifestEntry, bytes: Uint8Array): void {
    if (entry.source.kind !== "project") throw new Error("addEntry requires a project source");
    const { relativePath } = entry.source;
    this._bytes.set(relativePath, bytes);
    this._entries.push(entry);
    this.emit();
  }

  // Reserves an id/relativePath before the file exists — no bytes, no pending-persist.
  addPlaceholder(entry: MediaManifestEntry): void {
    this._entries.push(entry);
    this.emit();
  }

  patchEntry(id: string, patch: Partial<MediaManifestEntry>): void {
    if (!this._entries.some((e) => e.id === id)) return;
    this._entries = this._entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    this.emit();
  }

  // Reserved relativePath becomes real: same bytes/pending-persist mechanics as addEntry, in place.
  finalizeGenerated(id: string, bytes: Uint8Array, patch: Partial<MediaManifestEntry>): void {
    const entry = this._entries.find((e) => e.id === id);
    if (!entry) return;
    if (entry.source.kind !== "project") throw new Error("finalizeGenerated requires a project source");
    this._bytes.set(entry.source.relativePath, bytes);
    this._entries = this._entries.map((e) =>
      e.id === id ? { ...e, ...patch, generationStatus: undefined } : e
    );
    this.emit();
  }

  markGenerationFailed(ids: string[], message: string): void {
    const idSet = new Set(ids);
    const generationStatus = serializeGenerationStatus({ kind: "failed", message });
    this._entries = this._entries.map((e) => (idSet.has(e.id) ? { ...e, generationStatus } : e));
    this.emit();
  }

  // ── Folder / entry ops (T2) ──────────────────────────────────────────────

  createFolder(name: string, parentFolderId?: string): MediaFolder {
    if (parentFolderId !== undefined && !this._folders.some((f) => f.id === parentFolderId)) {
      throw new Error(`unknown parent folder: ${parentFolderId}`);
    }
    const folder = makeMediaFolder(name, parentFolderId);
    this._folders = [...this._folders, folder];
    this.emit();
    return folder;
  }

  renameFolder(folderId: string, name: string): void {
    if (!this._folders.some((f) => f.id === folderId)) throw new Error(`unknown folder: ${folderId}`);
    this._folders = this._folders.map((f) => (f.id === folderId ? { ...f, name } : f));
    this.emit();
  }

  renameEntry(entryId: string, name: string): void {
    if (!this._entries.some((e) => e.id === entryId)) throw new Error(`unknown media entry: ${entryId}`);
    this._entries = this._entries.map((e) => (e.id === entryId ? { ...e, name } : e));
    this.emit();
  }

  // Unknown/dangling folderId → root (undefined). Guards every entry-stamping import path (OS
  // drop/file-input, import_media bytes/url/path) against a folder deleted between the caller
  // resolving it and the entry actually landing (e.g. an agent's delete_folder over MCP racing an
  // in-flight import) — an entry stamped with a dead folderId would vanish from every view.
  resolveFolderId(folderId: string | undefined): string | undefined {
    if (folderId === undefined) return undefined;
    return this._folders.some((f) => f.id === folderId) ? folderId : undefined;
  }

  moveEntriesToFolder(assetIds: string[], folderId: string | undefined): void {
    if (folderId !== undefined && !this._folders.some((f) => f.id === folderId)) {
      throw new Error(`unknown folder: ${folderId}`);
    }
    const idSet = new Set(assetIds);
    this._entries = this._entries.map((e) => (idSet.has(e.id) ? { ...e, folderId } : e));
    this.emit();
  }

  // canMoveFolder-guarded (self/descendant/unknown-target rejected); T4 drag uses this directly —
  // no agent tool wraps it (Swift parity: moveFoldersToFolder has no ToolExecutor entry point).
  moveFolderToFolder(folderId: string, targetId: string | undefined): void {
    const index = buildFolderIndex(this._folders);
    if (!index.byId.has(folderId)) throw new Error(`unknown folder: ${folderId}`);
    if (!canMoveFolder(index, folderId, targetId)) {
      throw new Error(`cannot move folder ${folderId} into ${targetId ?? "root"}`);
    }
    this._folders = this._folders.map((f) => (f.id === folderId ? { ...f, parentFolderId: targetId } : f));
    this.emit();
  }

  // Cascades through subfolders (collectFolderCascade); removes contained assets' bytes/pending
  // state along with their manifest entries so a deleted folder leaves nothing dangling.
  deleteFolders(folderIds: string[]): { removedAssetIds: string[] } {
    const { folderIds: doomedFolders, assetIds: doomedAssets } = collectFolderCascade(
      this._folders,
      this._entries,
      folderIds,
    );
    this.dropAssetBytes(doomedAssets);
    this._folders = this._folders.filter((f) => !doomedFolders.has(f.id));
    this._entries = this._entries.filter((e) => !doomedAssets.has(e.id));
    this.emit();
    return { removedAssetIds: [...doomedAssets] };
  }

  deleteEntries(assetIds: string[]): void {
    const idSet = new Set(assetIds);
    this.dropAssetBytes(idSet);
    this._entries = this._entries.filter((e) => !idSet.has(e.id));
    this.emit();
  }

  private dropAssetBytes(assetIds: ReadonlySet<string>): void {
    for (const e of this._entries) {
      if (!assetIds.has(e.id) || e.source.kind !== "project") continue;
      this._bytes.delete(e.source.relativePath);
      this._persisted.delete(e.source.relativePath);
      this.thumbnails.delete(e.id);
    }
  }

  // OS file drop / file-input import (#219): placeholder-first, mirrors importBytes — each file's
  // entry lands (and emits) synchronously before any probing starts, so the panel shows the tile
  // immediately; probe + finalize happen in the background per file, one failure doesn't stop the rest.
  async importFiles(files: File[] | FileList, folderId?: string): Promise<MediaManifestEntry[]> {
    const added: MediaManifestEntry[] = [];
    const resolvedFolderId = this.resolveFolderId(folderId);

    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop() ?? "";
      const type = clipTypeFromFileExtension(ext);
      if (!type) continue;

      const id = crypto.randomUUID();
      const fileExt = ext || defaultExtForType(type);
      const relativePath = `media/${id}.${fileExt}`;
      const entry: MediaManifestEntry = {
        id,
        name: file.name,
        type,
        source: { kind: "project", relativePath },
        duration: 0,
        generationStatus: "downloading",
        ...(resolvedFolderId !== undefined ? { folderId: resolvedFolderId } : {}),
      };
      this.addPlaceholder(entry);
      added.push(entry);
      void this.finishFileImport(id, file, type);
    }

    return added;
  }

  private async finishFileImport(id: string, file: File, type: ClipType): Promise<void> {
    try {
      const probed = await probeMediaBlob(file as Blob, type);
      const bytes = new Uint8Array(await file.arrayBuffer());
      this.finalizeGenerated(id, bytes, {
        duration: probed.duration,
        ...(probed.sourceWidth !== undefined ? { sourceWidth: probed.sourceWidth } : {}),
        ...(probed.sourceHeight !== undefined ? { sourceHeight: probed.sourceHeight } : {}),
        ...(probed.hasAudio !== undefined ? { hasAudio: probed.hasAudio } : {}),
      });
      // finalizeGenerated no-ops when the entry was deleted mid-import — skip the thumbnail too,
      // or it leaks a dangling id → dataURL entry in `thumbnails` that nothing ever revisits.
      if (probed.thumb && this.entry(id)) this.thumbnails.set(id, probed.thumb);
    } catch (err) {
      this.markGenerationFailed([id], err instanceof Error ? err.message : String(err));
    }
  }

  // Sets/replaces an entry's thumbnail data URL (M12A T3: host-side url/path import flows finish
  // outside this class — via IPC/proxy — so they need a public seam into the private thumbnails map).
  setThumbnail(id: string, dataUrl: string): void {
    this.thumbnails.set(id, dataUrl);
  }

  // import_media's bytes source (both hosts, M12A T3): placeholder-first — registers the
  // placeholder synchronously and returns; probe + finalize happen in the background.
  async importBytes(bytes: Uint8Array, mimeType: string, name?: string, folderId?: string): Promise<{ assetId: string }> {
    const ext = extensionForImportMime(mimeType);
    const type = ext ? importTypeForExtension(ext) : undefined;
    if (!ext || !type) throw new Error(`Unsupported mimeType '${mimeType}'`);

    const id = crypto.randomUUID();
    const entry = createImportPlaceholderEntry({ id, type, name: name ?? "Imported asset", ext, folderId: this.resolveFolderId(folderId) });
    this.addPlaceholder(entry);
    void this.finishBytesImport(id, bytes, mimeType, type);
    return { assetId: id };
  }

  private async finishBytesImport(id: string, bytes: Uint8Array, mimeType: string, type: ClipType): Promise<void> {
    try {
      const blob = new Blob([bytes as BlobPart], { type: mimeType });
      const probed = await probeMediaBlob(blob, type);
      this.finalizeGenerated(id, bytes, {
        duration: probed.duration,
        ...(probed.sourceWidth !== undefined ? { sourceWidth: probed.sourceWidth } : {}),
        ...(probed.sourceHeight !== undefined ? { sourceHeight: probed.sourceHeight } : {}),
        ...(probed.hasAudio !== undefined ? { hasAudio: probed.hasAudio } : {}),
      });
      // Same delete-during-import race as finishFileImport — only keep the thumbnail if the entry
      // is still there after finalize.
      if (probed.thumb && this.entry(id)) this.thumbnails.set(id, probed.thumb);
    } catch (err) {
      this.markGenerationFailed([id], err instanceof Error ? err.message : String(err));
    }
  }
}

function defaultExtForType(type: string): string {
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  if (type === "lottie") return "json";
  return "png";
}

interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  thumb?: string;
}

export interface ProbedMedia {
  duration: number;
  sourceWidth?: number;
  sourceHeight?: number;
  hasAudio?: boolean;
  thumb?: string;
}

// Shared by importFiles (OS file drop) and import_media's host flows (bytes/url/path) — one probe
// implementation, reused everywhere a raw Blob needs duration/dimensions/thumbnail before an entry
// can be finalized.
export async function probeMediaBlob(blob: Blob, type: ClipType): Promise<ProbedMedia> {
  if (type === "video" || type === "audio") {
    const result = await withVideoElement(blob, type, async (el) => {
      const probed = await probeMediaElement(el, type);
      const thumb = type === "video" ? await captureVideoThumbnail(el, probed.duration) : undefined;
      return { ...probed, thumb };
    });
    return {
      duration: result.duration,
      sourceWidth: result.width,
      sourceHeight: result.height,
      hasAudio: result.hasAudio,
      thumb: result.thumb,
    };
  }
  if (type === "image") {
    const bmp = await createImageBitmap(blob);
    try {
      return { duration: 5, sourceWidth: bmp.width, sourceHeight: bmp.height, thumb: bitmapToThumbnail(bmp) };
    } finally {
      bmp.close();
    }
  }
  return { duration: 5 };
}

async function withVideoElement<T>(
  blob: Blob,
  type: "video" | "audio",
  fn: (el: HTMLVideoElement | HTMLAudioElement) => Promise<T>,
): Promise<T> {
  const url = URL.createObjectURL(blob);
  const el = document.createElement(type === "video" ? "video" : "audio") as HTMLVideoElement | HTMLAudioElement;
  el.preload = "metadata";
  el.muted = true;
  el.src = url;
  try {
    return await fn(el);
  } finally {
    el.removeAttribute("src");
    el.load();
    URL.revokeObjectURL(url);
  }
}

function probeMediaElement(el: HTMLVideoElement | HTMLAudioElement, type: "video" | "audio"): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const finish = (result: ProbeResult) => {
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      resolve({ duration: 5 });
    }, 8000);

    el.addEventListener("loadedmetadata", () => {
      const raw = el.duration;
      const dur = !isFinite(raw) || isNaN(raw) ? 5 : raw;
      if (type === "video") {
        const vid = el as HTMLVideoElement;
        finish({
          duration: dur,
          width: vid.videoWidth || undefined,
          height: vid.videoHeight || undefined,
          hasAudio: true,
        });
      } else {
        finish({ duration: dur, hasAudio: true });
      }
    });

    el.addEventListener("error", () => {
      finish({ duration: 5 });
    });

    el.load();
  });
}

function captureVideoThumbnail(el: HTMLVideoElement | HTMLAudioElement, duration: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const vid = el as HTMLVideoElement;
    const seekTime = Math.min(0.1, duration / 2);

    const timer = setTimeout(() => {
      resolve(undefined);
    }, 5000);

    vid.addEventListener("seeked", () => {
      clearTimeout(timer);
      try {
        const thumb = drawThumbnail(vid, vid.videoWidth, vid.videoHeight);
        resolve(thumb);
      } catch {
        resolve(undefined);
      }
    }, { once: true });

    vid.currentTime = seekTime;
  });
}

function bitmapToThumbnail(bmp: ImageBitmap): string | undefined {
  try {
    return drawThumbnail(bmp, bmp.width, bmp.height);
  } catch {
    return undefined;
  }
}

function drawThumbnail(source: CanvasImageSource, srcW: number, srcH: number): string {
  const maxSize = 160;
  const scale = srcW > srcH ? maxSize / srcW : maxSize / srcH;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}
