import type { ProjectStore } from "./project-store.js";

export type ProjectRef = { readonly id: string; readonly name: string };

export interface MediaGateway {
  writeMedia(relativePath: string, bytes: Uint8Array): Promise<void>;
  readMedia(relativePath: string): Promise<Uint8Array>;
  hasMedia(relativePath: string): Promise<boolean>;
}

export interface BoundProject {
  readonly ref: ProjectRef;
  readonly store: ProjectStore;
  readonly media: MediaGateway;
}

export interface ProjectGateway {
  pickOpen(): Promise<ProjectRef | null>;
  pickSaveAs(suggestedName: string): Promise<ProjectRef | null>;
  bind(ref: ProjectRef): Promise<BoundProject>;
  listRecent(): Promise<ProjectRef[]>;
  addRecent(ref: ProjectRef): Promise<void>;
}
