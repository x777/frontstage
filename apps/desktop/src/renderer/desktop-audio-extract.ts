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

// One raw ffprobe reading per path — { tag, fps } — that the renderer turns into a SourceTimecode
// via @palmier/core's parseTimecodeTag (main.cjs stays free of the @palmier/core ESM dependency).
export interface RawTimecodeProbe {
  tag: string;
  fps: number;
}

interface DesktopMediaBridge {
  extractAudio(opts: { path?: string; bytes?: ArrayBuffer }): Promise<{ wav: ArrayBuffer; durationSeconds: number } | { error: string }>;
  // Media import (M12A T3) — bytes never cross IPC; main scans/copies/downloads on-disk directly.
  importScan(dir: string, absPath: string): Promise<ImportScanResult | { error: string }>;
  importCopy(dir: string, absPath: string, relPath: string): Promise<{ ok: true } | { error: string }>;
  importDownload(dir: string, url: string, relPath: string): Promise<{ ok: true; size: number } | { error: string }>;
  // Timeline interchange export (M12B T3) — batched ffprobe timecode reads; missing paths are
  // simply absent from the result (0-based export), never an error.
  readTimecode(paths: string[]): Promise<Record<string, RawTimecodeProbe>>;
  // .cube LUT persistence (M14C T2) — reads an ARBITRARY absolute local path (not project-scoped,
  // unlike importCopy/importScan), so apply_color's lut.path can be validated/parsed in the
  // renderer before it's stored into the project via the library's writeDerived flow.
  readLocalFile(absPath: string): Promise<{ bytes: ArrayBuffer } | { error: string }>;
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
