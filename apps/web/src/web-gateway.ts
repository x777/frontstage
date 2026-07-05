import type { BoundProject, ProjectGateway, ProjectRef } from "@frontstage/core";
import { dirHandleProjectStore, WebMediaGateway } from "./web-fs.js";

export type WebProjectRef = ProjectRef & { handle: FileSystemDirectoryHandle };

export interface WebGatewayOptions {
  pickDirectory?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle | null>;
  dbName?: string;
}

async function defaultPicker(
  opts?: { mode?: "read" | "readwrite" },
): Promise<FileSystemDirectoryHandle | null> {
  if (!("showDirectoryPicker" in window))
    throw new Error("File System Access is not supported in this browser");
  try {
    return await (window as any).showDirectoryPicker({ mode: opts?.mode ?? "readwrite" });
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return null;
    throw e;
  }
}

// ── tiny IndexedDB helpers ────────────────────────────────────────────────────

function openDB(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("recent", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db: IDBDatabase): Promise<RecentEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recent", "readonly");
    const req = tx.objectStore("recent").getAll();
    req.onsuccess = () => resolve(req.result as RecentEntry[]);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, value: RecentEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recent", "readwrite");
    const req = tx.objectStore("recent").put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recent", "readwrite");
    const req = tx.objectStore("recent").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

interface RecentEntry {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  order: number;
}

// ── WebGateway ────────────────────────────────────────────────────────────────

export class WebGateway implements ProjectGateway {
  private readonly pick: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle | null>;
  private readonly dbName: string;
  // id → handle; populated by refFor so enqueueOpen can reconstruct a full WebProjectRef from a bare {id,name}.
  private readonly _handleMap = new Map<string, FileSystemDirectoryHandle>();
  private readonly _openQueue: WebProjectRef[] = [];

  constructor(opts?: WebGatewayOptions) {
    this.pick = opts?.pickDirectory ?? defaultPicker;
    this.dbName = opts?.dbName ?? "frontstage-recent";
  }

  // Test seam: queue a ref (possibly bare {id,name} or with a handle serialized as {}) to be returned
  // by the next pickOpen() call. Always falls back to _handleMap to reconstruct the real handle.
  enqueueOpen(ref: ProjectRef): void {
    const handle = this._handleMap.get(ref.id);
    if (!handle) throw new Error("enqueueOpen: no handle in _handleMap for ref id=" + ref.id);
    this._openQueue.push({ id: ref.id, name: ref.name, handle });
  }

  async pickOpen(): Promise<ProjectRef | null> {
    if (this._openQueue.length > 0) return this._openQueue.shift()!;
    const h = await this.pick({ mode: "readwrite" });
    return h ? this.refFor(h) : null;
  }

  async pickSaveAs(_name: string): Promise<ProjectRef | null> {
    const h = await this.pick({ mode: "readwrite" });
    return h ? this.refFor(h) : null;
  }

  private refFor(handle: FileSystemDirectoryHandle): WebProjectRef {
    const id = crypto.randomUUID();
    this._handleMap.set(id, handle);
    return { id, name: handle.name, handle };
  }

  async bind(ref: ProjectRef): Promise<BoundProject> {
    const wr = ref as WebProjectRef;
    if (!wr.handle || typeof (wr.handle as any).getFileHandle !== "function") {
      throw new Error("WebGateway.bind: ref has no valid FileSystemDirectoryHandle for " + ref.name);
    }
    // OPFS handles (from navigator.storage) don't expose queryPermission/requestPermission.
    // Guard so we only call them on user-picked handles that support the permission API.
    if (typeof (wr.handle as any).queryPermission === "function") {
      const opt = { mode: "readwrite" as const };
      let p = await (wr.handle as any).queryPermission(opt);
      if (p !== "granted") p = await (wr.handle as any).requestPermission(opt);
      if (p !== "granted") {
        await this.removeRecent(ref);
        throw new Error("permission denied: " + ref.name);
      }
    }
    return {
      ref,
      store: dirHandleProjectStore(wr.handle),
      media: new WebMediaGateway(wr.handle),
    };
  }

  async listRecent(): Promise<ProjectRef[]> {
    try {
      const db = await openDB(this.dbName);
      const entries = await idbGetAll(db);
      db.close();
      return entries
        .sort((a, b) => b.order - a.order)
        .map(({ id, name, handle }) => ({ id, name, handle } as WebProjectRef));
    } catch {
      return [];
    }
  }

  async addRecent(ref: ProjectRef): Promise<void> {
    try {
      const wr = ref as WebProjectRef;
      const db = await openDB(this.dbName);
      const entries = await idbGetAll(db);
      // Remove oldest entries if we'd exceed cap 10 (excluding the current id)
      const others = entries.filter((e) => e.id !== wr.id).sort((a, b) => b.order - a.order);
      if (others.length >= 10) {
        // drop the oldest (last after sort desc)
        for (const old of others.slice(9)) {
          await idbDelete(db, old.id);
        }
      }
      const maxOrder = entries.reduce((m, e) => Math.max(m, e.order), 0);
      await idbPut(db, { id: wr.id, name: wr.name, handle: wr.handle, order: maxOrder + 1 });
      db.close();
    } catch {
      // tolerate broken DB
    }
  }

  async removeRecent(ref: ProjectRef): Promise<void> {
    try {
      const db = await openDB(this.dbName);
      await idbDelete(db, ref.id);
      db.close();
    } catch {
      // tolerate broken DB
    }
  }
}
