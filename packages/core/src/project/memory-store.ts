import type { ProjectStore } from "./project-store.js";

export class MemoryProjectStore implements ProjectStore {
  private files = new Map<string, string>();

  async readText(name: string): Promise<string | null> {
    return this.files.has(name) ? this.files.get(name)! : null;
  }

  async writeText(name: string, data: string): Promise<void> {
    this.files.set(name, data);
  }

  snapshot(): Map<string, string> {
    return new Map(this.files);
  }
}
