import {
  type DecodedProjectFiles,
  type ProjectDoc,
  PROJECT_FILES,
  decodeProjectFiles,
  encodeProjectFiles,
} from "../schema/serialize.js";
import type { ProjectStore } from "./project-store.js";

export interface ReadProjectResult extends DecodedProjectFiles {
  /** raw media.json text as read from disk (null if absent) — kept so a corrupt original can be preserved on save. */
  rawManifestText: string | null;
}

export interface WriteProjectOptions {
  /** write this raw text for media.json instead of the encoded manifest — preserves an unreadable original. */
  preserveManifestText?: string;
}

export async function writeProject(store: ProjectStore, doc: ProjectDoc, opts?: WriteProjectOptions): Promise<void> {
  const files = encodeProjectFiles(doc);
  if (opts?.preserveManifestText !== undefined) {
    files[PROJECT_FILES.manifest] = opts.preserveManifestText;
  }
  for (const [name, data] of Object.entries(files)) {
    await store.writeText(name, data);
  }
}

export async function readProject(store: ProjectStore): Promise<ReadProjectResult> {
  const timeline = await store.readText(PROJECT_FILES.timeline);
  if (timeline === null) throw new Error(`readProject: missing ${PROJECT_FILES.timeline}`);
  const manifest = await store.readText(PROJECT_FILES.manifest);
  const generationLog = await store.readText(PROJECT_FILES.generationLog);
  const decoded = decodeProjectFiles({
    timeline,
    manifest: manifest ?? undefined,
    generationLog: generationLog ?? undefined,
  });
  return { ...decoded, rawManifestText: manifest };
}
