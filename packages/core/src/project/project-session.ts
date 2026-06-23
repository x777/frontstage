import type { GenerationLog } from "../generation-log.js";
import { emptyGenerationLog } from "../generation-log.js";
import type { MediaManifest } from "../media.js";
import type { Timeline } from "../timeline.js";
import { defaultTimeline } from "../timeline.js";
import { emptyMediaManifest } from "../media.js";
import type { ProjectDoc } from "../schema/serialize.js";
import { readProject, writeProject } from "./project-io.js";
import type { BoundProject, ProjectGateway, ProjectRef } from "./gateway.js";

export interface ProjectHost {
  getTimeline(): Timeline;
  getManifest(): MediaManifest;
  getGenerationLog(): GenerationLog;
  loadDoc(doc: ProjectDoc): void;
  pendingMedia(): Map<string, Uint8Array>;
  markMediaPersisted(relativePaths: string[]): void;
}

export type ConfirmDiscard = () => Promise<boolean>;

export interface ProjectSessionState {
  ref: ProjectRef | null;
  name: string;
}

function manifestRelativePaths(manifest: MediaManifest): string[] {
  return manifest.entries.flatMap((e) =>
    e.source.kind === "project" ? [e.source.relativePath] : []
  );
}

export class ProjectSession {
  private host: ProjectHost;
  private gateway: ProjectGateway;
  private untitledName: string;
  private state: ProjectSessionState;
  private bound: BoundProject | null = null;
  private savedTimeline: Timeline;
  private savedManifest: MediaManifest;
  private listeners: Set<() => void> = new Set();

  constructor(host: ProjectHost, gateway: ProjectGateway, untitledName = "Untitled") {
    this.host = host;
    this.gateway = gateway;
    this.untitledName = untitledName;
    this.state = { ref: null, name: untitledName };
    this.savedTimeline = host.getTimeline();
    this.savedManifest = host.getManifest();
  }

  // Returns a fresh object each call; callers using useSyncExternalStore must memoize/select fields.
  getState(): ProjectSessionState {
    return { ...this.state };
  }

  // Fires on lifecycle changes only (new/open/save/saveAs); UI must poll isDirty() via EditorStore/MediaLibrary subscription for dirty indicator.
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  // generationLog intentionally excluded from dirty — only timeline + manifest.
  isDirty(): boolean {
    return (
      this.host.getTimeline() !== this.savedTimeline ||
      this.host.getManifest() !== this.savedManifest
    );
  }

  async newProject(confirm: ConfirmDiscard): Promise<boolean> {
    if (this.isDirty() && !(await confirm())) return false;
    this.host.loadDoc({
      timeline: defaultTimeline(),
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    });
    this.state = { ref: null, name: this.untitledName };
    this.bound = null;
    this.advanceSaved();
    this.emit();
    return true;
  }

  async open(confirm: ConfirmDiscard, ref?: ProjectRef): Promise<boolean> {
    if (this.isDirty() && !(await confirm())) return false;
    const r = ref ?? (await this.gateway.pickOpen());
    if (!r) return false;
    const bound = await this.gateway.bind(r);
    const doc = await readProject(bound.store);
    this.host.loadDoc(doc);
    this.bound = bound;
    this.state = { ref: r, name: r.name };
    this.advanceSaved();
    await this.gateway.addRecent(r);
    this.emit();
    return true;
  }

  async save(): Promise<boolean> {
    if (this.state.ref == null || this.bound == null) return this.saveAs();
    await this.persist(this.bound);
    this.advanceSaved();
    this.emit();
    return true;
  }

  async saveAs(): Promise<boolean> {
    const r = await this.gateway.pickSaveAs(this.state.name);
    if (!r) return false;
    const newBound = await this.gateway.bind(r);

    // Copy all project-media into the new project
    const paths = manifestRelativePaths(this.host.getManifest());
    const pending = this.host.pendingMedia();
    for (const path of paths) {
      if (pending.has(path)) {
        await newBound.media.writeMedia(path, pending.get(path)!);
      } else if (this.bound) {
        await newBound.media.writeMedia(path, await this.bound.media.readMedia(path));
      } else {
        throw new Error(`saveAs: cannot source media "${path}" (not pending and no bound project)`);
      }
    }

    await this.persist(newBound);
    this.bound = newBound;
    this.state = { ref: r, name: r.name };
    this.advanceSaved();
    await this.gateway.addRecent(r);
    this.emit();
    return true;
  }

  private async persist(bound: BoundProject): Promise<void> {
    await writeProject(bound.store, {
      timeline: this.host.getTimeline(),
      manifest: this.host.getManifest(),
      generationLog: this.host.getGenerationLog(),
    });
    const pending = this.host.pendingMedia();
    for (const [path, bytes] of pending) {
      await bound.media.writeMedia(path, bytes);
    }
    this.host.markMediaPersisted([...pending.keys()]);
  }

  private advanceSaved(): void {
    this.savedTimeline = this.host.getTimeline();
    this.savedManifest = this.host.getManifest();
  }
}
