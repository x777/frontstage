import type { ClipType } from "../clip-type.js";
import type { GenerationInput, MediaManifestEntry } from "../media.js";

export type GenerationStatus =
  | { kind: "none" }
  | { kind: "preparing" }
  | { kind: "generating" }
  | { kind: "downloading" }
  | { kind: "rendering" }
  | { kind: "failed"; message: string };

const FAILED_PREFIX = "failed: ";

/** none/preparing are transient and must never restore as in-progress (Swift: MediaAsset.GenerationStatus.manifestValue). */
export function serializeGenerationStatus(status: GenerationStatus): string | undefined {
  switch (status.kind) {
    case "none":
    case "preparing":
      return undefined;
    case "failed":
      return `${FAILED_PREFIX}${status.message}`;
    default:
      return status.kind;
  }
}

export function parseGenerationStatus(raw: string | undefined): GenerationStatus {
  switch (raw) {
    case undefined:
      return { kind: "none" };
    case "preparing":
      return { kind: "preparing" };
    case "generating":
    case "downloading":
    case "rendering":
      return { kind: raw };
    default:
      return raw.startsWith(FAILED_PREFIX)
        ? { kind: "failed", message: raw.slice(FAILED_PREFIX.length) }
        : { kind: "none" };
  }
}

export function canResumeGeneration(entry: MediaManifestEntry): boolean {
  return (entry.generationInput?.backendJobId?.length ?? 0) > 0;
}

export function isRecoveringGeneration(entry: MediaManifestEntry): boolean {
  if (!canResumeGeneration(entry)) return false;
  const status = parseGenerationStatus(entry.generationStatus);
  if (status.kind === "generating" || status.kind === "downloading" || status.kind === "rendering") return true;
  if (status.kind === "failed") return (entry.generationInput?.resultURLs?.length ?? 0) > 0;
  return false;
}

export function createPlaceholderEntry(args: {
  id: string;
  type: ClipType;
  name: string;
  duration: number;
  ext: string;
  genInput: Partial<GenerationInput> & Pick<GenerationInput, "prompt">;
  folderId?: string;
}): MediaManifestEntry {
  const entry: MediaManifestEntry = {
    id: args.id,
    name: args.name,
    type: args.type,
    duration: args.duration,
    source: { kind: "project", relativePath: `media/gen-${args.id.slice(0, 8)}.${args.ext}` },
    generationInput: args.genInput as GenerationInput,
    generationStatus: "preparing",
  };
  if (args.folderId !== undefined) entry.folderId = args.folderId;
  return entry;
}

/** Never-persist-preparing rule: strip transient statuses before writing the manifest. */
export function normalizeEntryForSave(entry: MediaManifestEntry): MediaManifestEntry {
  const serialized = serializeGenerationStatus(parseGenerationStatus(entry.generationStatus));
  return serialized === entry.generationStatus ? entry : { ...entry, generationStatus: serialized };
}

/** Stuck-reset rule: an in-flight status with no resumable job is dead weight; clear it. Failed survives (visible error). */
export function normalizeEntryOnLoad(entry: MediaManifestEntry): MediaManifestEntry {
  const status = parseGenerationStatus(entry.generationStatus);
  if (status.kind === "none" || status.kind === "failed") return entry;
  return canResumeGeneration(entry) ? entry : { ...entry, generationStatus: undefined };
}
