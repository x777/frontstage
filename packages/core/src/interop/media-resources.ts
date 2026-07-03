import type { MediaManifestEntry, MediaSource } from "../media.js";
import type { Timeline } from "../timeline.js";

export interface MediaResource {
  /** r1, r2, … in order of first appearance while walking the timeline. */
  id: string;
  entry: MediaManifestEntry;
  /** lastPathComponent WITH extension (#247 — relink-by-filename). */
  fileName: string;
  /** Absolute file:// URL, forward-slash even on Windows. */
  fileUrl: string;
}

/**
 * Walks `timeline.tracks[].clips[]` once and dedupes by `mediaRef`, keeping only clips whose
 * mediaRef has a manifest entry (an unresolvable clip is dropped by callers, mirroring Swift's
 * `resolver.resolveURL != nil` gate — minus the disk-existence check, which needs a platform host).
 */
export function collectMediaResources(
  timeline: Timeline,
  entries: MediaManifestEntry[],
  projectRoot: string | undefined,
  projectName: string,
): { byRef: Map<string, MediaResource>; ordered: MediaResource[] } {
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const byRef = new Map<string, MediaResource>();
  const ordered: MediaResource[] = [];

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (byRef.has(clip.mediaRef)) continue;
      const entry = entriesById.get(clip.mediaRef);
      if (!entry) continue;
      const resource: MediaResource = {
        id: `r${ordered.length + 1}`,
        entry,
        fileName: lastPathComponent(sourcePath(entry.source)),
        fileUrl: resolveFileUrl(entry.source, projectRoot, projectName),
      };
      byRef.set(clip.mediaRef, resource);
      ordered.push(resource);
    }
  }
  return { byRef, ordered };
}

function sourcePath(source: MediaSource): string {
  return source.kind === "external" ? source.absolutePath : source.relativePath;
}

/** Exported for FCPXML export, which dedupes assets by physical file (not mediaRef) — see fcpxml-exporter.ts. */
export function lastPathComponent(path: string): string {
  const segments = path.split(/[/\\]/).filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1]! : path;
}

/** No `projectRoot` (web, no filesystem) → best-effort `file:///<projectName>/<rel>`, `rel` conventionally `media/...`. */
export function resolveFileUrl(source: MediaSource, projectRoot: string | undefined, projectName: string): string {
  if (source.kind === "external") return toFileUrl(source.absolutePath);
  const base = projectRoot ?? projectName;
  return toFileUrl(joinPath(base, source.relativePath));
}

function joinPath(base: string, rel: string): string {
  const b = base.replace(/[\\/]+$/, "");
  const r = rel.replace(/^[\\/]+/, "");
  return `${b}/${r}`;
}

/** Normalizes backslashes and produces a forward-slash `file://` URL (Windows drive letters kept literal, unencoded). */
function toFileUrl(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/");
  const isWindowsDrive = /^[A-Za-z]:\//.test(normalized);
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const segments = withLeadingSlash
    .split("/")
    .map((seg, i) => (isWindowsDrive && i === 1 ? seg : encodeURIComponent(seg)));
  return `file://${segments.join("/")}`;
}
