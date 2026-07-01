import type { GenerationLog } from "../generation-log.js";
import { emptyGenerationLog } from "../generation-log.js";
import type { MediaManifest } from "../media.js";
import { emptyMediaManifest } from "../media.js";
import type { Timeline } from "../timeline.js";
import { GenerationLogSchema, MediaManifestSchema, TimelineSchema } from "./schemas.js";
import { CURRENT_SCHEMA_VERSION, migrateProjectJson } from "./migrations.js";

export interface ProjectDoc {
  timeline: Timeline;
  manifest: MediaManifest;
  generationLog: GenerationLog;
}

export interface DecodedProjectFiles extends ProjectDoc {
  /** media.json existed but failed to decode — manifest degraded to empty so the project still opens. */
  manifestUnreadable: boolean;
}

export const PROJECT_FILES = {
  timeline: "project.json",
  manifest: "media.json",
  generationLog: "generation-log.json",
} as const;

export function encodeProjectFiles(doc: ProjectDoc): Record<string, string> {
  return {
    [PROJECT_FILES.timeline]: JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, ...doc.timeline }),
    [PROJECT_FILES.manifest]: JSON.stringify(doc.manifest),
    [PROJECT_FILES.generationLog]: JSON.stringify(doc.generationLog),
  };
}

export function decodeProjectFiles(files: {
  timeline: string;
  manifest?: string;
  generationLog?: string;
}): DecodedProjectFiles {
  const migrated = migrateProjectJson(JSON.parse(files.timeline));
  const timeline = TimelineSchema.parse(migrated);

  // A bad manifest must not lose the project; degrade to "media offline" and let the caller
  // preserve the original file on disk instead of clobbering it with an empty one.
  let manifest: MediaManifest;
  let manifestUnreadable = false;
  // !== undefined: a 0-byte file (truncated write) is corrupt, not missing.
  if (files.manifest !== undefined) {
    try {
      manifest = MediaManifestSchema.parse(JSON.parse(files.manifest));
    } catch {
      manifest = emptyMediaManifest();
      manifestUnreadable = true;
    }
  } else {
    manifest = emptyMediaManifest();
  }

  let generationLog: GenerationLog;
  try {
    generationLog = GenerationLogSchema.parse(files.generationLog ? JSON.parse(files.generationLog) : {});
  } catch {
    generationLog = emptyGenerationLog();
  }

  return { timeline, manifest, generationLog, manifestUnreadable };
}
