import type { MediaGateway, ProjectGateway, BoundProject, ProjectRef } from "./gateway.js";
import { MemoryProjectStore } from "./memory-store.js";

export class InMemoryMediaGateway implements MediaGateway {
  private map = new Map<string, Uint8Array>();

  async writeMedia(relativePath: string, bytes: Uint8Array): Promise<void> {
    this.map.set(relativePath, bytes.slice());
  }

  async readMedia(relativePath: string): Promise<Uint8Array> {
    const data = this.map.get(relativePath);
    if (data === undefined) throw new Error("media not found: " + relativePath);
    return data;
  }

  async hasMedia(relativePath: string): Promise<boolean> {
    return this.map.has(relativePath);
  }
}

type Entry = { store: MemoryProjectStore; media: InMemoryMediaGateway; name: string };

export class InMemoryProjectGateway implements ProjectGateway {
  private projects = new Map<string, Entry>();
  private recentIds: string[] = [];
  private counter = 0;
  private openQueue: ProjectRef[];
  private saveAsFactory: (name: string) => ProjectRef | null;

  constructor(opts?: { openQueue?: ProjectRef[]; saveAsFactory?: (name: string) => ProjectRef | null }) {
    this.openQueue = opts?.openQueue ? [...opts.openQueue] : [];
    this.saveAsFactory =
      opts?.saveAsFactory ??
      ((name) => {
        const ref: ProjectRef = { id: "mem-" + this.counter++, name };
        this.projects.set(ref.id, { store: new MemoryProjectStore(), media: new InMemoryMediaGateway(), name });
        return ref;
      });
  }

  async pickOpen(): Promise<ProjectRef | null> {
    return this.openQueue.shift() ?? null;
  }

  async pickSaveAs(suggestedName: string): Promise<ProjectRef | null> {
    const ref = this.saveAsFactory(suggestedName);
    if (ref === null) return null;
    this.projects.set(ref.id, { store: new MemoryProjectStore(), media: new InMemoryMediaGateway(), name: ref.name });
    return ref;
  }

  async bind(ref: ProjectRef): Promise<BoundProject> {
    let entry = this.projects.get(ref.id);
    if (!entry) {
      entry = { store: new MemoryProjectStore(), media: new InMemoryMediaGateway(), name: ref.name };
      this.projects.set(ref.id, entry);
    }
    return { ref, store: entry.store, media: entry.media };
  }

  async addRecent(ref: ProjectRef): Promise<void> {
    this.recentIds = [ref.id, ...this.recentIds.filter((id) => id !== ref.id)].slice(0, 10);
  }

  async listRecent(): Promise<ProjectRef[]> {
    return this.recentIds
      .map((id) => {
        const entry = this.projects.get(id);
        return entry ? { id, name: entry.name } : null;
      })
      .filter((ref) => ref !== null) as ProjectRef[];
  }
}
