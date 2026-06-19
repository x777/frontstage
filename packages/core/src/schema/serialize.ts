import type { GenerationLog } from "../generation-log.js";
import type { MediaManifest } from "../media.js";
import type { Timeline } from "../timeline.js";
import { GenerationLogSchema, MediaManifestSchema, TimelineSchema } from "./schemas.js";
import { CURRENT_SCHEMA_VERSION, migrateProjectJson } from "./migrations.js";

export interface ProjectDoc {
  timeline: Timeline;
  manifest: MediaManifest;
  generationLog: GenerationLog;
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
}): ProjectDoc {
  const migrated = migrateProjectJson(JSON.parse(files.timeline));
  const timeline = TimelineSchema.parse(migrated);
  const manifest = MediaManifestSchema.parse(files.manifest ? JSON.parse(files.manifest) : {});
  const generationLog = GenerationLogSchema.parse(files.generationLog ? JSON.parse(files.generationLog) : {});
  return { timeline, manifest, generationLog };
}
