import type { MediaManifestEntry } from "../media.js";
import { isRecoveringGeneration, normalizeEntryOnLoad } from "./generation-status.js";

export interface ResumableJob {
  backendJobId: string;
  entries: MediaManifestEntry[]; // sorted by outputIndex
}

/** Port of Swift GenerationService.resumePendingGenerations grouping: jobs to resume after relaunch. */
export function scanResumableGenerations(entries: MediaManifestEntry[]): ResumableJob[] {
  const order: string[] = [];
  const groups = new Map<string, MediaManifestEntry[]>();
  for (const entry of entries) {
    if (!isRecoveringGeneration(entry)) continue;
    const jobId = entry.generationInput!.backendJobId!;
    let group = groups.get(jobId);
    if (!group) {
      group = [];
      groups.set(jobId, group);
      order.push(jobId);
    }
    group.push(entry);
  }
  return order.map((backendJobId) => ({
    backendJobId,
    entries: [...groups.get(backendJobId)!].sort(
      (a, b) => (a.generationInput?.outputIndex ?? 0) - (b.generationInput?.outputIndex ?? 0),
    ),
  }));
}

/** Port of VideoProject's stuck-reset pass applied on project load. */
export function resetStuckGenerations(entries: MediaManifestEntry[]): MediaManifestEntry[] {
  return entries.map(normalizeEntryOnLoad);
}
