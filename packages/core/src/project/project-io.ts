import { type ProjectDoc, PROJECT_FILES, decodeProjectFiles, encodeProjectFiles } from "../schema/serialize.js";
import type { ProjectStore } from "./project-store.js";

export async function writeProject(store: ProjectStore, doc: ProjectDoc): Promise<void> {
  const files = encodeProjectFiles(doc);
  for (const [name, data] of Object.entries(files)) {
    await store.writeText(name, data);
  }
}

export async function readProject(store: ProjectStore): Promise<ProjectDoc> {
  const timeline = await store.readText(PROJECT_FILES.timeline);
  if (timeline === null) throw new Error(`readProject: missing ${PROJECT_FILES.timeline}`);
  const manifest = await store.readText(PROJECT_FILES.manifest);
  const generationLog = await store.readText(PROJECT_FILES.generationLog);
  return decodeProjectFiles({
    timeline,
    manifest: manifest ?? undefined,
    generationLog: generationLog ?? undefined,
  });
}
