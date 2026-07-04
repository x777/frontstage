import type { Timeline } from "../timeline.js";
import type { GapSelection, TimelineRangeSelection } from "../timeline/ripple-types.js";
import { normalizeRange, isValidRange } from "../timeline/ripple-types.js";

export interface EditorView {
  zoom: number;
  scrollX: number;
}

export type FocusedPanel = "media" | "preview" | "timeline" | "inspector";

export const PANEL_IDS: readonly FocusedPanel[] = ["media", "preview", "timeline", "inspector"];

export function isValidPanel(v: unknown): v is FocusedPanel {
  return PANEL_IDS.includes(v as FocusedPanel);
}

export interface PanelLayout {
  focused: FocusedPanel;
  maximized: FocusedPanel | null;
  hidden: FocusedPanel[];
}

export interface EditorState {
  timeline: Timeline;
  selection: ReadonlySet<string>;
  selectedGap: GapSelection | null;
  selectedTimelineRange: TimelineRangeSelection | null;
  playhead: number;
  view: EditorView;
  layout: PanelLayout;
}

export interface Command {
  label: string;
  coalesceKey?: string;
  apply(timeline: Timeline): Timeline;
}

export class EditorStore {
  private state: EditorState;
  private undoStack: Timeline[] = [];
  private redoStack: Timeline[] = [];
  private lastCoalesceKey: string | null = null;
  private listeners: Set<() => void> = new Set();

  constructor(initial: Timeline) {
    this.state = {
      timeline: initial,
      selection: new Set(),
      selectedGap: null,
      selectedTimelineRange: null,
      playhead: 0,
      view: { zoom: 1, scrollX: 0 },
      layout: { focused: "timeline", maximized: null, hidden: [] },
    };
  }

  getSnapshot(): EditorState {
    return this.state;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  select(ids: Iterable<string>): void {
    const next = new Set(ids);
    const cur = this.state.selection;
    const sameSel = next.size === cur.size && [...next].every((id) => cur.has(id));
    if (sameSel && this.state.selectedGap === null) return;
    this.state = { ...this.state, selection: next, selectedGap: null };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setSelectedGap(gap: GapSelection | null): void {
    this.state = { ...this.state, selectedGap: gap, selection: gap ? new Set() : this.state.selection };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setSelectedTimelineRange(range: TimelineRangeSelection | null): void {
    const clamped = range ? { startFrame: Math.max(0, range.startFrame), endFrame: Math.max(0, range.endFrame) } : null;
    this.state = { ...this.state, selectedTimelineRange: clamped };
    this.lastCoalesceKey = null;
    this.emit();
  }

  keepValidTimelineRangeOrClear(): void {
    const r = this.state.selectedTimelineRange;
    const next = r && isValidRange(r) ? normalizeRange(r) : null;
    this.state = { ...this.state, selectedTimelineRange: next };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setPlayhead(frame: number): void {
    if (frame === this.state.playhead) return;
    this.state = { ...this.state, playhead: frame };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setZoom(z: number): void {
    if (z === this.state.view.zoom) return;
    this.state = { ...this.state, view: { ...this.state.view, zoom: z } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setScroll(x: number): void {
    if (x === this.state.view.scrollX) return;
    this.state = { ...this.state, view: { ...this.state.view, scrollX: x } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setFocusedPanel(p: FocusedPanel): void {
    if (p === this.state.layout.focused) return;
    this.state = { ...this.state, layout: { ...this.state.layout, focused: p } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setMaximized(p: FocusedPanel | null): void {
    if (p === this.state.layout.maximized) return;
    this.state = { ...this.state, layout: { ...this.state.layout, maximized: p } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  togglePanelHidden(p: FocusedPanel): void {
    const hidden = this.state.layout.hidden;
    const next = hidden.includes(p) ? hidden.filter((h) => h !== p) : [...hidden, p];
    // no-op if same set (same size and same elements in same order doesn't matter — set equality)
    if (next.length === hidden.length && next.every((h, i) => h === hidden[i])) return;
    this.state = { ...this.state, layout: { ...this.state.layout, hidden: next } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  restore(partial: { layout?: Partial<PanelLayout>; view?: Partial<EditorView> }): void {
    const layout = partial.layout
      ? { ...this.state.layout, ...partial.layout }
      : this.state.layout;
    const view = partial.view ? { ...this.state.view, ...partial.view } : this.state.view;
    this.state = { ...this.state, layout, view };
    this.lastCoalesceKey = null;
    this.emit();
  }

  /**
   * Ends the current coalesce run without touching any state. Call this at drag-gesture end
   * (pointerup/cancel) so a follow-up gesture reusing the same coalesceKey (e.g. two separate
   * trim drags on an already-selected clip edge, where select() on an already-selected clip is a
   * no-op) starts its own undo entry instead of silently merging into the prior gesture's.
   */
  breakCoalescing(): void {
    this.lastCoalesceKey = null;
  }

  dispatch(cmd: Command): void {
    const prior = this.state.timeline;
    const next = cmd.apply(prior);
    if (next === prior) return;
    if (cmd.coalesceKey != null && cmd.coalesceKey === this.lastCoalesceKey) {
      // coalescing — don't push, prior is already captured
    } else {
      this.undoStack.push(prior);
      this.redoStack = [];
    }
    this.lastCoalesceKey = cmd.coalesceKey ?? null;
    this.state = { ...this.state, timeline: next };
    this.emit();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.state.timeline);
    this.state = { ...this.state, timeline: this.undoStack.pop()! };
    this.lastCoalesceKey = null;
    this.emit();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.state.timeline);
    this.state = { ...this.state, timeline: this.redoStack.pop()! };
    this.lastCoalesceKey = null;
    this.emit();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  load(timeline: Timeline): void {
    this.state = {
      timeline,
      selection: new Set(),
      selectedGap: null,
      selectedTimelineRange: null,
      playhead: 0,
      view: { zoom: 1, scrollX: 0 },
      layout: this.state.layout,
    };
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.emit();
  }
}
