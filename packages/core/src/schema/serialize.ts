import type { GenerationLog } from "../generation-log.js";
import { emptyGenerationLog } from "../generation-log.js";
import type { MediaManifest } from "../media.js";
import { emptyMediaManifest } from "../media.js";
import type { ProjectFile, TimelineViewState } from "../project-file.js";
import { activeTimeline, wrapLegacyTimeline } from "../project-file.js";
import type { Timeline } from "../timeline.js";
import { ensureTimeline } from "../timeline.js";
import { GenerationLogSchema, MediaManifestSchema, ProjectFileSchema, TimelineSchema } from "./schemas.js";
import { CURRENT_SCHEMA_VERSION, migrateProjectJson } from "./migrations.js";

export interface ProjectDoc {
  timeline: Timeline;
  timelines?: Timeline[];
  activeTimelineId?: string;
  openTimelineIds?: string[];
  viewStates?: Record<string, TimelineViewState>;
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

function projectFileFromDoc(doc: ProjectDoc): ProjectFile {
  if (doc.timelines && doc.timelines.length > 0) {
    const timelines = doc.timelines.map(ensureTimeline);
    const ids = new Set(timelines.map((t) => t.id!));
    const active = doc.activeTimelineId && ids.has(doc.activeTimelineId) ? doc.activeTimelineId : timelines[0]!.id!;
    const open = (doc.openTimelineIds ?? [active]).filter((id) => ids.has(id));
    return {
      timelines,
      activeTimelineId: active,
      openTimelineIds: open.length ? open : [active],
      viewStates: doc.viewStates,
    };
  }
  return wrapLegacyTimeline(doc.timeline);
}

export function encodeProjectFiles(doc: ProjectDoc): Record<string, string> {
  const file = projectFileFromDoc(doc);
  return {
    [PROJECT_FILES.timeline]: JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, ...file }),
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
  const file = parseProjectFile(migrated);
  const timeline = activeTimeline(file);

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

  return {
    timeline,
    timelines: file.timelines,
    activeTimelineId: file.activeTimelineId,
    openTimelineIds: file.openTimelineIds,
    viewStates: file.viewStates,
    manifest,
    generationLog,
    manifestUnreadable,
  };
}

function parseProjectFile(migrated: Record<string, unknown>): ProjectFile {
  if (Array.isArray(migrated.timelines)) {
    const parsed = ProjectFileSchema.parse(migrated);
    const timelines = parsed.timelines.map((t) => TimelineSchema.parse(t));
    const ids = new Set(timelines.map((t) => t.id!));
    const active = parsed.activeTimelineId && ids.has(parsed.activeTimelineId) ? parsed.activeTimelineId : timelines[0]!.id!;
    const open = (parsed.openTimelineIds ?? [active]).filter((id) => ids.has(id));
    return {
      timelines,
      activeTimelineId: active,
      openTimelineIds: open.length ? open : [active],
      viewStates: parsed.viewStates,
    };
  }
  return wrapLegacyTimeline(TimelineSchema.parse(migrated));
}
