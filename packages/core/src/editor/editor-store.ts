import type { ProjectFile, TimelineViewState } from "../project-file.js";
import { defaultTimelineViewState, duplicateTimelineName, nextTimelineName } from "../project-file.js";
import type { Timeline } from "../timeline.js";
import { ensureTimeline, regenerateTimelineIds, timelineTotalFrames } from "../timeline.js";
import { planDecomposeNest, planNestSelectedClips } from "./nest-commands.js";
import type { GapSelection, TimelineRangeSelection } from "../timeline/ripple-types.js";
import { normalizeRange, isValidRange } from "../timeline/ripple-types.js";

export type ToolMode = "pointer" | "razor" | "trim";

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
  timelines: Timeline[];
  activeTimelineId: string;
  openTimelineIds: string[];
  selection: ReadonlySet<string>;
  selectedGap: GapSelection | null;
  selectedTimelineRange: TimelineRangeSelection | null;
  playhead: number;
  view: EditorView;
  layout: PanelLayout;
  toolMode: ToolMode;
}

interface ProjectUndoEntry {
  timelines: Timeline[];
  activeTimelineId: string;
  openTimelineIds: string[];
}

export interface Command {
  label: string;
  coalesceKey?: string;
  apply(timeline: Timeline): Timeline;
}

export class EditorStore {
  private state: EditorState;
  private undoStack: ProjectUndoEntry[] = [];
  private redoStack: ProjectUndoEntry[] = [];
  private lastCoalesceKey: string | null = null;
  private listeners: Set<() => void> = new Set();
  private viewStates: Record<string, TimelineViewState> = {};

  constructor(initial: Timeline) {
    const t = ensureTimeline(initial);
    this.state = {
      timeline: t,
      timelines: [t],
      activeTimelineId: t.id!,
      openTimelineIds: [t.id!],
      selection: new Set(),
      selectedGap: null,
      selectedTimelineRange: null,
      playhead: 0,
      view: { zoom: 1, scrollX: 0 },
      layout: { focused: "timeline", maximized: null, hidden: [] },
      toolMode: "pointer",
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

  setToolMode(mode: ToolMode): void {
    if (mode === this.state.toolMode) return;
    this.state = { ...this.state, toolMode: mode };
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

  private projectEntry(): ProjectUndoEntry {
    return {
      timelines: this.state.timelines,
      activeTimelineId: this.state.activeTimelineId,
      openTimelineIds: this.state.openTimelineIds,
    };
  }

  private replaceActive(next: Timeline, pushUndo: boolean): void {
    const id = this.state.activeTimelineId;
    const timelines = this.state.timelines.map((t) => (t.id === id ? { ...next, id, name: next.name ?? t.name } : t));
    if (pushUndo) {
      this.undoStack.push(this.projectEntry());
      this.redoStack = [];
    }
    this.state = { ...this.state, timeline: timelines.find((t) => t.id === id)!, timelines };
  }

  private restoreProject(entry: ProjectUndoEntry): void {
    const active = entry.timelines.find((t) => t.id === entry.activeTimelineId) ?? entry.timelines[0]!;
    this.state = {
      ...this.state,
      timeline: active,
      timelines: entry.timelines,
      activeTimelineId: active.id!,
      openTimelineIds: entry.openTimelineIds,
      selection: new Set(),
      selectedGap: null,
      selectedTimelineRange: null,
    };
  }

  dispatch(cmd: Command): void {
    const prior = this.state.timeline;
    const next = cmd.apply(prior);
    if (next === prior) return;
    const pushUndo = !(cmd.coalesceKey != null && cmd.coalesceKey === this.lastCoalesceKey);
    this.lastCoalesceKey = cmd.coalesceKey ?? null;
    this.replaceActive(next, pushUndo);
    this.emit();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.projectEntry());
    this.restoreProject(this.undoStack.pop()!);
    this.lastCoalesceKey = null;
    this.emit();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.projectEntry());
    this.restoreProject(this.redoStack.pop()!);
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
    const t = ensureTimeline(timeline);
    this.viewStates = {};
    this.state = {
      timeline: t,
      timelines: [t],
      activeTimelineId: t.id!,
      openTimelineIds: [t.id!],
      selection: new Set(),
      selectedGap: null,
      selectedTimelineRange: null,
      playhead: 0,
      view: { zoom: 1, scrollX: 0 },
      layout: this.state.layout,
      toolMode: "pointer",
    };
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.emit();
  }

  loadProject(file: ProjectFile): void {
    const timelines = file.timelines.map(ensureTimeline);
    if (timelines.length === 0) return;
    const ids = new Set(timelines.map((t) => t.id!));
    const activeId = file.activeTimelineId && ids.has(file.activeTimelineId) ? file.activeTimelineId : timelines[0]!.id!;
    const open = (file.openTimelineIds ?? [activeId]).filter((id) => ids.has(id));
    this.viewStates = file.viewStates ?? {};
    const active = timelines.find((t) => t.id === activeId)!;
    const vs = this.viewStates[activeId] ?? defaultTimelineViewState();
    this.state = {
      timeline: active,
      timelines,
      activeTimelineId: activeId,
      openTimelineIds: open.length ? open : [activeId],
      selection: new Set(),
      selectedGap: null,
      selectedTimelineRange: null,
      playhead: Math.min(Math.max(0, vs.playheadFrame), Math.max(0, timelineTotalFrames(active))),
      view: { zoom: vs.zoomScale || 1, scrollX: vs.scrollOffsetX },
      layout: this.state.layout,
      toolMode: "pointer",
    };
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.emit();
  }

  projectFile(): ProjectFile {
    this.stashActiveView();
    const ids = new Set(this.state.timelines.map((t) => t.id!));
    return {
      timelines: this.state.timelines,
      activeTimelineId: this.state.activeTimelineId,
      openTimelineIds: this.state.openTimelineIds,
      viewStates: Object.fromEntries(Object.entries(this.viewStates).filter(([id]) => ids.has(id))),
    };
  }

  private stashActiveView(): void {
    this.viewStates[this.state.activeTimelineId] = {
      playheadFrame: this.state.playhead,
      zoomScale: this.state.view.zoom,
      scrollOffsetX: this.state.view.scrollX,
    };
  }

  timelineById(id: string): Timeline | undefined {
    return this.state.timelines.find((t) => t.id === id);
  }

  activateTimeline(id: string): void {
    if (id === this.state.activeTimelineId) return;
    const target = this.timelineById(id);
    if (!target) return;
    this.stashActiveView();
    const vs = this.viewStates[id] ?? defaultTimelineViewState();
    const open = this.state.openTimelineIds.includes(id) ? this.state.openTimelineIds : [...this.state.openTimelineIds, id];
    this.state = {
      ...this.state,
      timeline: target,
      activeTimelineId: id,
      openTimelineIds: open,
      selection: new Set(),
      selectedGap: null,
      selectedTimelineRange: null,
      playhead: Math.min(Math.max(0, vs.playheadFrame), Math.max(0, timelineTotalFrames(target))),
      view: { ...this.state.view, zoom: vs.zoomScale || 1, scrollX: vs.scrollOffsetX },
    };
    this.lastCoalesceKey = null;
    this.emit();
  }

  createTimeline(name?: string, activate = true): string {
    const active = this.state.timeline;
    const t = ensureTimeline({
      fps: active.fps,
      width: active.width,
      height: active.height,
      settingsConfigured: active.settingsConfigured,
      tracks: [],
      name: name?.trim() || nextTimelineName(this.state.timelines),
      markers: [],
    });
    this.undoStack.push(this.projectEntry());
    this.redoStack = [];
    this.state = { ...this.state, timelines: [...this.state.timelines, t] };
    if (activate) this.activateTimeline(t.id!);
    else this.emit();
    return t.id!;
  }

  duplicateTimeline(id: string, activate = true): string | undefined {
    const source = this.timelineById(id);
    if (!source) return undefined;
    const copy = regenerateTimelineIds({
      ...source,
      name: duplicateTimelineName(source.name ?? "Timeline 1", this.state.timelines),
    });
    this.viewStates[copy.id!] = this.viewStates[id] ?? defaultTimelineViewState();
    this.undoStack.push(this.projectEntry());
    this.redoStack = [];
    this.state = { ...this.state, timelines: [...this.state.timelines, copy] };
    if (activate) this.activateTimeline(copy.id!);
    else this.emit();
    return copy.id!;
  }

  renameTimeline(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = this.timelineById(id);
    if (!current || current.name === trimmed) return;
    const timelines = this.state.timelines.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
    this.undoStack.push(this.projectEntry());
    this.redoStack = [];
    const timeline = this.state.activeTimelineId === id ? { ...this.state.timeline, name: trimmed } : this.state.timeline;
    this.state = { ...this.state, timelines, timeline };
    this.emit();
  }

  deleteTimeline(id: string): boolean {
    if (this.state.timelines.length <= 1) return false;
    const index = this.state.timelines.findIndex((t) => t.id === id);
    if (index === -1) return false;
    this.undoStack.push(this.projectEntry());
    this.redoStack = [];
    if (this.state.activeTimelineId === id) {
      const fallback = this.state.openTimelineIds.find((x) => x !== id) ?? this.state.timelines.find((t) => t.id !== id)!.id!;
      this.activateTimeline(fallback);
    }
    delete this.viewStates[id];
    this.state = {
      ...this.state,
      timelines: this.state.timelines.filter((t) => t.id !== id),
      openTimelineIds: this.state.openTimelineIds.filter((x) => x !== id),
    };
    this.emit();
    return true;
  }

  applyToAllTimelines(fn: (t: Timeline) => Timeline): void {
    const timelines = this.state.timelines.map(fn);
    const timeline = timelines.find((t) => t.id === this.state.activeTimelineId) ?? timelines[0]!;
    this.undoStack.push(this.projectEntry());
    this.redoStack = [];
    this.state = { ...this.state, timelines, timeline };
    this.emit();
  }

  /** Palmier `nestSelectedClips` — one project undo (new child timeline + parent carriers). */
  nestSelectedClips(newId: () => string = () => crypto.randomUUID()): boolean {
    const plan = planNestSelectedClips(this.state.timeline, this.state.selection, this.state.timelines, newId);
    if (!plan || !plan.child.id) return false;
    const activeId = this.state.activeTimelineId;
    this.undoStack.push(this.projectEntry());
    this.redoStack = [];
    this.lastCoalesceKey = null;
    const timelines = [
      ...this.state.timelines.map((t) => (t.id === activeId ? { ...plan.parent, id: activeId, name: t.name } : t)),
      plan.child,
    ];
    const open = this.state.openTimelineIds.includes(plan.child.id)
      ? this.state.openTimelineIds
      : [...this.state.openTimelineIds, plan.child.id];
    this.state = {
      ...this.state,
      timeline: timelines.find((t) => t.id === activeId)!,
      timelines,
      openTimelineIds: open,
      selection: new Set(plan.carrierIds),
      selectedGap: null,
      selectedTimelineRange: null,
    };
    this.emit();
    return true;
  }

  /** Palmier `decomposeNest`. */
  decomposeNest(clipId: string, newId: () => string = () => crypto.randomUUID()): { discardedGroupLook: boolean } | null {
    const loc = this.state.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!loc || loc.sourceClipType !== "sequence") return null;
    const child = this.timelineById(loc.mediaRef);
    if (!child) return null;
    const plan = planDecomposeNest(this.state.timeline, clipId, child, newId);
    if (!plan) return null;
    const activeId = this.state.activeTimelineId;
    this.undoStack.push(this.projectEntry());
    this.redoStack = [];
    this.lastCoalesceKey = null;
    const timelines = this.state.timelines.map((t) => (t.id === activeId ? { ...plan.timeline, id: activeId, name: t.name } : t));
    const group = loc.linkGroupId;
    const selection = new Set([...this.state.selection].filter((id) => {
      if (id === clipId) return false;
      if (!group) return true;
      const clip = this.state.timeline.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id);
      return clip?.linkGroupId !== group;
    }));
    this.state = {
      ...this.state,
      timeline: timelines.find((t) => t.id === activeId)!,
      timelines,
      selection,
      selectedGap: null,
      selectedTimelineRange: null,
    };
    this.emit();
    return { discardedGroupLook: plan.discardedGroupLook };
  }
}
