import type { MediaManifestEntry } from "@frontstage/core";

export interface MediaDragSnapshot {
  entry: MediaManifestEntry;
  x: number;
  y: number;
  ripple: boolean;
  // The `data-folder-drop` id under the pointer, or null when not hovering a drop target.
  // Drives FolderTile/MediaBreadcrumbs hover styling while this custom drag is active.
  hoverFolderId: string | null;
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

  start(entry: MediaManifestEntry, clientX: number, clientY: number, ripple = false): void {
    this._snapshot = { entry, x: clientX, y: clientY, ripple, hoverFolderId: null };
    this._emit();
  }

  update(clientX: number, clientY: number, ripple?: boolean, hoverFolderId?: string | null): void {
    if (!this._snapshot) return;
    this._snapshot = {
      ...this._snapshot,
      x: clientX,
      y: clientY,
      ripple: ripple ?? this._snapshot.ripple,
      hoverFolderId: hoverFolderId === undefined ? this._snapshot.hoverFolderId : hoverFolderId,
    };
    this._emit();
  }

  end(): { entry: MediaManifestEntry; clientX: number; clientY: number; ripple: boolean } | null {
    const snap = this._snapshot;
    if (!snap) return null;
    this._snapshot = null;
    this._emit();
    return { entry: snap.entry, clientX: snap.x, clientY: snap.y, ripple: snap.ripple };
  }

  cancel(): void {
    if (!this._snapshot) return;
    this._snapshot = null;
    this._emit();
  }
}
