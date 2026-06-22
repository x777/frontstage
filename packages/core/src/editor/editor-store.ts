import type { Timeline } from "../timeline.js";

export interface EditorView {
  zoom: number;
  scrollX: number;
}

export type FocusedPanel = "media" | "preview" | "timeline" | "inspector";

export interface PanelLayout {
  focused: FocusedPanel;
  maximized: FocusedPanel | null;
  hidden: FocusedPanel[];
}

export interface EditorState {
  timeline: Timeline;
  selection: ReadonlySet<string>;
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
    this.state = { ...this.state, selection: new Set(ids) };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setPlayhead(frame: number): void {
    this.state = { ...this.state, playhead: frame };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setZoom(z: number): void {
    this.state = { ...this.state, view: { ...this.state.view, zoom: z } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setScroll(x: number): void {
    this.state = { ...this.state, view: { ...this.state.view, scrollX: x } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setFocusedPanel(p: FocusedPanel): void {
    this.state = { ...this.state, layout: { ...this.state.layout, focused: p } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  setMaximized(p: FocusedPanel | null): void {
    this.state = { ...this.state, layout: { ...this.state.layout, maximized: p } };
    this.lastCoalesceKey = null;
    this.emit();
  }

  togglePanelHidden(p: FocusedPanel): void {
    const hidden = this.state.layout.hidden;
    const next = hidden.includes(p) ? hidden.filter((h) => h !== p) : [...hidden, p];
    this.state = { ...this.state, layout: { ...this.state.layout, hidden: next } };
    this.lastCoalesceKey = null;
    this.emit();
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
}
