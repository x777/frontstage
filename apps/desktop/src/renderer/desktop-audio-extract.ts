export interface ImportScanFile {
  abs: string;
  rel: string;
  ext: string;
  size: number;
}

export interface ImportScanResult {
  files: ImportScanFile[];
  dirs: string[];
}

interface DesktopMediaBridge {
  extractAudio(opts: { path?: string; bytes?: ArrayBuffer }): Promise<{ wav: ArrayBuffer; durationSeconds: number } | { error: string }>;
  // Media import (M12A T3) — bytes never cross IPC; main scans/copies/downloads on-disk directly.
  importScan(dir: string, absPath: string): Promise<ImportScanResult | { error: string }>;
  importCopy(dir: string, absPath: string, relPath: string): Promise<{ ok: true } | { error: string }>;
  importDownload(dir: string, url: string, relPath: string): Promise<{ ok: true; size: number } | { error: string }>;
}

declare global {
  interface Window {
    desktopMedia: DesktopMediaBridge;
  }
}

export interface DesktopAudioExtractDeps {
  // in-memory bytes for unsaved media (wins over the resolved path when present)
  libraryBytes(mediaRef: string): Uint8Array | null;
  // on-disk path (project dir + relativePath, or absolutePath for external sources)
  resolvePath(mediaRef: string): string | null;
}

export function makeDesktopAudioExtractor(
  deps: DesktopAudioExtractDeps,
): (mediaRef: string) => Promise<{ wav: Uint8Array; durationSeconds: number }> {
  return async (mediaRef: string) => {
    const bytes = deps.libraryBytes(mediaRef);
    const opts = bytes
      ? { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
      : { path: requirePath(deps, mediaRef) };

    const res = await window.desktopMedia.extractAudio(opts);
    if ("error" in res) throw new Error(res.error);
    return { wav: new Uint8Array(res.wav), durationSeconds: res.durationSeconds };
  };
}

function requirePath(deps: DesktopAudioExtractDeps, mediaRef: string): string {
  const path = deps.resolvePath(mediaRef);
  if (!path) throw new Error("no in-memory bytes or resolvable path for media: " + mediaRef);
  return path;
}
