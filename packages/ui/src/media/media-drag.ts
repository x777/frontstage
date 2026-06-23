import type { MediaManifestEntry } from "@palmier/core";

export interface MediaDragSnapshot {
  entry: MediaManifestEntry;
  x: number;
  y: number;
}

export class MediaDragController {
  private _snapshot: MediaDragSnapshot | null = null;
  private _listeners = new Set<() => void>();

  private _emit(): void {
    for (const cb of this._listeners) cb();
  }

  getSnapshot(): MediaDragSnapshot | null {
    return this._snapshot;
  }

  subscribe(cb: () => void): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  start(entry: MediaManifestEntry, clientX: number, clientY: number): void {
    this._snapshot = { entry, x: clientX, y: clientY };
    this._emit();
  }

  update(clientX: number, clientY: number): void {
    if (!this._snapshot) return;
    this._snapshot = { ...this._snapshot, x: clientX, y: clientY };
    this._emit();
  }

  end(): { entry: MediaManifestEntry; clientX: number; clientY: number } | null {
    const snap = this._snapshot;
    if (!snap) return null;
    this._snapshot = null;
    this._emit();
    return { entry: snap.entry, clientX: snap.x, clientY: snap.y };
  }

  cancel(): void {
    if (!this._snapshot) return;
    this._snapshot = null;
    this._emit();
  }
}
