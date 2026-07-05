import type { EditorStore } from "@frontstage/core";
import { splitAtPlayheadCommand, trimStartToPlayheadCommand, trimEndToPlayheadCommand } from "@frontstage/core";

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Returns true when handled (caller preventDefaults). Meta combos first, then plain tool keys.
// Deviation from the M17B brief: Z/K are also gated on isEditableTarget so Ctrl+Z in a text field
// runs the field's own undo rather than the timeline's (S/O/N are untouched, unguarded as before).
export function handleEditorKeydown(e: KeyboardEvent, store: EditorStore): boolean {
  const meta = e.metaKey || e.ctrlKey;
  const snap = store.getSnapshot();
  if (meta && !e.altKey) {
    const k = e.key.toLowerCase();
    if ((k === "z" || k === "k") && isEditableTarget(e.target)) return false;
    if (k === "z") { e.shiftKey ? store.redo() : store.undo(); return true; }
    if (k === "k") { store.dispatch(splitAtPlayheadCommand([...snap.selection], snap.playhead)); return true; }
    return false;
  }
  if (e.altKey || isEditableTarget(e.target)) return false;
  switch (e.key.toLowerCase()) {
    case "v": store.setToolMode("pointer"); return true;
    case "c": store.setToolMode("razor"); return true;
    case "q": store.dispatch(trimStartToPlayheadCommand([...snap.selection], snap.playhead)); return true;
    case "w": store.dispatch(trimEndToPlayheadCommand([...snap.selection], snap.playhead)); return true;
    default: return false;
  }
}
