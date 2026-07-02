import type { MediaManifestEntry } from "@palmier/core";

// Swift's cachedRemoteURL TTL: 6 days. cachedRemoteURLExpiresAt is stored ISO-8601 (see media.ts).
const CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000;

export interface EntryUrlDeps {
  entries(): MediaManifestEntry[];
  patchEntry(id: string, patch: Partial<MediaManifestEntry>): void;
  // In-memory bytes for the entry, if the library still holds them (unsaved/pending-persist).
  bytesFor(entry: MediaManifestEntry): Uint8Array | undefined;
  // Falls back to the project's media gateway when bytesFor misses (project-relative path).
  readMedia(relativePath: string): Promise<Uint8Array>;
  uploadFile(bytes: Uint8Array, contentType: string, fileName: string): Promise<string>;
  now(): number;
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  tiff: "image/tiff",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  m4a: "audio/mp4",
};

const MIME_BY_TYPE: Record<string, string> = {
  video: "video/mp4",
  audio: "audio/mpeg",
  image: "image/png",
};

function pathOf(entry: MediaManifestEntry): string {
  return entry.source.kind === "project" ? entry.source.relativePath : entry.source.absolutePath;
}

export function mimeForEntry(entry: MediaManifestEntry): string {
  const ext = pathOf(entry).split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? MIME_BY_TYPE[entry.type] ?? "application/octet-stream";
}

function fileNameForEntry(entry: MediaManifestEntry): string {
  return pathOf(entry).split(/[\\/]/).pop() || entry.name;
}

// Resolves a library media ref to a fal-fetchable URL: cache-first (the 6-day TTL fal.ai
// storage grants), else uploads and patches the cache fields so the next call is free.
export function makeEntryUrl(deps: EntryUrlDeps): (mediaRef: string) => Promise<string | undefined> {
  return async function entryUrl(mediaRef: string): Promise<string | undefined> {
    const entry = deps.entries().find((e) => e.id === mediaRef);
    if (!entry) return undefined;

    if (entry.cachedRemoteURL && entry.cachedRemoteURLExpiresAt) {
      const expiresAt = new Date(entry.cachedRemoteURLExpiresAt).getTime();
      if (expiresAt > deps.now()) return entry.cachedRemoteURL;
    }

    let bytes = deps.bytesFor(entry);
    if (!bytes) {
      if (entry.source.kind !== "project") return undefined;
      try {
        bytes = await deps.readMedia(entry.source.relativePath);
      } catch {
        return undefined;
      }
    }
    if (!bytes || bytes.length === 0) return undefined;

    const url = await deps.uploadFile(bytes, mimeForEntry(entry), fileNameForEntry(entry));
    deps.patchEntry(entry.id, {
      cachedRemoteURL: url,
      cachedRemoteURLExpiresAt: new Date(deps.now() + CACHE_TTL_MS).toISOString(),
    });
    return url;
  };
}
