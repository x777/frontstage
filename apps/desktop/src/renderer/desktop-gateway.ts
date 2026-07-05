import type { ProjectGateway, ProjectRef, BoundProject } from "@frontstage/core";

export type DesktopProjectRef = ProjectRef & { path: string };

export interface ExportSaveFilter {
  name: string;
  extensions: string[];
}

interface DesktopProjectBridge {
  pickOpen(): Promise<string | null>;
  pickSaveAs(name: string): Promise<string | null>;
  pickExportSave(name: string, filter?: ExportSaveFilter): Promise<string | null>;
  // Writes text directly to an already-authorized absolute path (M12B T3 — xml/fcpxml export with
  // an explicit outputPath). overwrite=false + an existing file → rejects.
  writeExportText(outPath: string, contents: string, overwrite?: boolean): Promise<string>;
  readText(dir: string, name: string): Promise<string | null>;
  writeText(dir: string, name: string, data: string): Promise<void>;
  writeMedia(dir: string, rel: string, bytes: Uint8Array): Promise<void>;
  readMedia(dir: string, rel: string): Promise<Uint8Array>;
  hasMedia(dir: string, rel: string): Promise<boolean>;
  listRecent(): Promise<DesktopProjectRef[]>;
  addRecent(rec: { id: string; name: string; path: string }): Promise<void>;
  removeRecent(id: string): Promise<void>;
  __setNextPick(p: string): Promise<void>;
  __setNextExportPick?(p: string): Promise<void>;
  onMenuCommand(cb: (cmd: string, arg?: unknown) => void): void;
  platform?: string;
}

declare global {
  interface Window {
    desktopProject: DesktopProjectBridge;
  }
}

export function refFor(p: string): DesktopProjectRef {
  const name = p.split(/[\\/]/).pop()!;
  return { id: p, name, path: p };
}

export class DesktopGateway implements ProjectGateway {
  async pickOpen(): Promise<ProjectRef | null> {
    const p = await window.desktopProject.pickOpen();
    if (!p) return null;
    return refFor(p);
  }

  async pickSaveAs(suggestedName: string): Promise<ProjectRef | null> {
    const p = await window.desktopProject.pickSaveAs(suggestedName);
    if (!p) return null;
    return refFor(p);
  }

  async bind(ref: ProjectRef): Promise<BoundProject> {
    const dr = ref as DesktopProjectRef;
    const p = dr.path;
    return {
      ref,
      store: {
        readText: (name) => window.desktopProject.readText(p, name),
        writeText: (name, data) => window.desktopProject.writeText(p, name, data),
      },
      media: {
        writeMedia: (rel, bytes) => window.desktopProject.writeMedia(p, rel, bytes),
        readMedia: (rel) => window.desktopProject.readMedia(p, rel),
        hasMedia: (rel) => window.desktopProject.hasMedia(p, rel),
      },
    };
  }

  async listRecent(): Promise<ProjectRef[]> {
    return window.desktopProject.listRecent();
  }

  async addRecent(ref: ProjectRef): Promise<void> {
    const dr = ref as DesktopProjectRef;
    await window.desktopProject.addRecent({ id: dr.id, name: dr.name, path: dr.path });
  }

  async removeRecent(ref: ProjectRef): Promise<void> {
    await window.desktopProject.removeRecent(ref.id);
  }
}
