import type { MediaManifestEntry } from "../media.js";
import { parseGenerationStatus } from "./generation-status.js";

/** Palmier: video + hasAudio + not generating + not offline. */
export function canExtractAudioFromEntry(entry: MediaManifestEntry): boolean {
  if (entry.type !== "video") return false;
  if (entry.hasAudio !== true) return false;
  const status = parseGenerationStatus(entry.generationStatus);
  return status.kind === "none" || status.kind === "failed";
}

export function extractedAudioName(sourceName: string): string {
  return `${sourceName} (audio)`;
}

export function makeExtractedAudioEntry(args: {
  source: MediaManifestEntry;
  id: string;
  duration: number;
}): MediaManifestEntry {
  const entry: MediaManifestEntry = {
    id: args.id,
    name: extractedAudioName(args.source.name),
    type: "audio",
    duration: args.duration,
    source: { kind: "project", relativePath: `media/extracted-${args.id.slice(0, 8)}.wav` },
    hasAudio: true,
  };
  if (args.source.folderId !== undefined) entry.folderId = args.source.folderId;
  return entry;
}

/**
 * Library-asset outcome of Palmier `extractAudio(from:)`: append a new audio entry, leave the
 * source video untouched. Duration is that of the extracted soundtrack (host demux).
 */
export function extractAudioIntoManifest(
  entries: readonly MediaManifestEntry[],
  sourceId: string,
  extractedDuration: number,
  newId: () => string,
): { entries: MediaManifestEntry[]; extracted: MediaManifestEntry } | { error: string } {
  const source = entries.find((e) => e.id === sourceId);
  if (!source) return { error: `media asset not found: ${sourceId}` };
  if (!canExtractAudioFromEntry(source)) {
    return { error: `cannot extract audio from '${sourceId}'` };
  }
  const extracted = makeExtractedAudioEntry({ source, id: newId(), duration: extractedDuration });
  return { entries: [...entries, extracted], extracted };
}
