import { clipTypeFromFileExtension } from "@palmier/core";
import type { MediaManifestEntry } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";

interface LibrarySnapshot {
  entries: MediaManifestEntry[];
}

export class MediaLibrary {
  private blobs = new Map<string, Blob>();
  private thumbnails = new Map<string, string>();
  private _entries: MediaManifestEntry[] = [];
  private _snapshot: LibrarySnapshot = { entries: [] };
  private listeners = new Set<() => void>();

  getSnapshot(): LibrarySnapshot {
    return this._snapshot;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    this._snapshot = { entries: [...this._entries] };
    for (const l of this.listeners) l();
  }

  thumbnail(id: string): string | undefined {
    return this.thumbnails.get(id);
  }

  entry(id: string): MediaManifestEntry | undefined {
    return this._entries.find((e) => e.id === id);
  }

  get byteSource(): MediaByteSource {
    return {
      open: (ref: string) => {
        const blob = this.blobs.get(ref);
        if (!blob) throw new Error("media not found: " + ref);
        return Promise.resolve(blob);
      },
    };
  }

  async seed(ref: string, url: string, entry: MediaManifestEntry): Promise<void> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
    const blob = await r.blob();
    this.blobs.set(ref, blob);
    this._entries.push(entry);
    this.emit();
  }

  async importFiles(files: File[] | FileList): Promise<MediaManifestEntry[]> {
    const added: MediaManifestEntry[] = [];

    for (const file of Array.from(files)) {
      try {
        const ext = file.name.split(".").pop() ?? "";
        const type = clipTypeFromFileExtension(ext);
        if (!type) continue;

        const blob = file as Blob;
        let duration = 5;
        let sourceWidth: number | undefined;
        let sourceHeight: number | undefined;
        let hasAudio: boolean | undefined;
        let thumbUrl: string | undefined;

        if (type === "video" || type === "audio") {
          const objectUrl = URL.createObjectURL(blob);
          try {
            const result = await probeMedia(objectUrl, type);
            duration = result.duration;
            sourceWidth = result.width;
            sourceHeight = result.height;
            hasAudio = result.hasAudio;

            if (type === "video" && result.el) {
              thumbUrl = await captureVideoThumbnail(result.el, duration);
            }
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        } else if (type === "image") {
          duration = 5;
          const objectUrl = URL.createObjectURL(blob);
          try {
            const bmp = await createImageBitmap(blob);
            sourceWidth = bmp.width;
            sourceHeight = bmp.height;
            thumbUrl = bitmapToThumbnail(bmp);
            bmp.close();
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        }

        const id = crypto.randomUUID();
        const entry: MediaManifestEntry = {
          id,
          name: file.name,
          type,
          source: { kind: "external", absolutePath: file.name },
          duration,
          ...(sourceWidth !== undefined ? { sourceWidth } : {}),
          ...(sourceHeight !== undefined ? { sourceHeight } : {}),
          ...(hasAudio !== undefined ? { hasAudio } : {}),
        };

        this.blobs.set(id, blob);
        if (thumbUrl) this.thumbnails.set(id, thumbUrl);
        this._entries.push(entry);
        added.push(entry);
      } catch {
        // tolerate failures per file
      }
    }

    if (added.length > 0) this.emit();
    return added;
  }
}

interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  el?: HTMLVideoElement;
}

function probeMedia(objectUrl: string, type: "video" | "audio"): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const el = document.createElement(type === "video" ? "video" : "audio") as HTMLVideoElement | HTMLAudioElement;
    el.preload = "metadata";
    el.muted = true;

    const cleanup = () => {
      el.src = "";
      el.load();
    };

    const finish = (result: ProbeResult) => {
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      cleanup();
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
          el: vid,
        });
      } else {
        cleanup();
        finish({ duration: dur, hasAudio: true });
      }
    });

    el.addEventListener("error", () => {
      cleanup();
      finish({ duration: 5 });
    });

    el.src = objectUrl;
    el.load();
  });
}

function captureVideoThumbnail(el: HTMLVideoElement, duration: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const seekTime = Math.min(0.1, duration / 2);

    const timer = setTimeout(() => {
      el.src = "";
      el.load();
      resolve(undefined);
    }, 5000);

    el.addEventListener("seeked", () => {
      clearTimeout(timer);
      try {
        const thumb = drawThumbnail(el, el.videoWidth, el.videoHeight);
        resolve(thumb);
      } catch {
        resolve(undefined);
      } finally {
        el.src = "";
        el.load();
      }
    }, { once: true });

    el.currentTime = seekTime;
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
