import type { EditorStore } from "./editor-store.js";
import { selectForward, forwardSelectionAnchorId, type SelectForwardScope } from "./selection.js";
import { rippleDeleteSelectedClips, rippleDeleteGap, type RippleOutcome, type RippleGapOutcome } from "./ripple-commands.js";
import { linkClipsCommand, unlinkClipsCommand } from "./link-commands.js";

export function selectForwardAction(store: EditorStore, scope: SelectForwardScope): void {
  const { timeline, selection } = store.getSnapshot();
  const anchor = forwardSelectionAnchorId(timeline, selection);
  if (!anchor) return;
  store.select(selectForward(timeline, anchor, scope)); // also clears the gap
  store.setSelectedTimelineRange(null);
}

// Context-menu entry point: the anchor is the exact right-clicked clip, not the earliest-selected
// one (that distinction is selectForwardAction's job, for the keyboard shortcut).
export function selectForwardFromClip(store: EditorStore, clipId: string, scope: SelectForwardScope): void {
  const { timeline } = store.getSnapshot();
  store.select(selectForward(timeline, clipId, scope)); // also clears the gap
  store.setSelectedTimelineRange(null);
}

export function dispatchRippleDeleteSelection(store: EditorStore): RippleOutcome {
  const { timeline, selection } = store.getSnapshot();
  const ids = new Set(selection);
  const out = rippleDeleteSelectedClips(timeline, ids);
  if ("timeline" in out) {
    store.dispatch({
      label: "Ripple Delete",
      apply: (tl) => {
        const o = rippleDeleteSelectedClips(tl, ids);
        return "timeline" in o ? o.timeline : tl;
      },
    });
    store.select([]);
  }
  return out;
}

export function dispatchRippleDeleteGap(store: EditorStore): RippleGapOutcome {
  const { timeline, selectedGap } = store.getSnapshot();
  if (!selectedGap) return { timeline };
  const gap = selectedGap;
  const out = rippleDeleteGap(timeline, gap);
  if ("stale" in out) {
    store.setSelectedGap(null);
    return out;
  }
  if ("timeline" in out) {
    store.dispatch({
      label: "Ripple Delete Gap",
      apply: (tl) => {
        const o = rippleDeleteGap(tl, gap);
        return "timeline" in o ? o.timeline : tl;
      },
    });
    store.setSelectedGap(null);
  }
  return out;
}

export function dispatchLinkSelection(store: EditorStore): void {
  store.dispatch(linkClipsCommand([...store.getSnapshot().selection]));
}

export function dispatchUnlinkSelection(store: EditorStore): void {
  store.dispatch(unlinkClipsCommand([...store.getSnapshot().selection]));
  store.select([]);
}
