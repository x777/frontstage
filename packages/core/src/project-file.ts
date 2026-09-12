import type { Timeline } from "./timeline.js";
import { ensureTimeline } from "./timeline.js";

export interface TimelineViewState {
  playheadFrame: number;
  zoomScale: number;
  scrollOffsetX: number;
}

export function defaultTimelineViewState(): TimelineViewState {
  return { playheadFrame: 0, zoomScale: 1, scrollOffsetX: 0 };
}

/** Root of project.json from Palmier v0.9.0. Legacy files are a bare Timeline. */
export interface ProjectFile {
  timelines: Timeline[];
  activeTimelineId: string;
  openTimelineIds?: string[];
  viewStates?: Record<string, TimelineViewState>;
}

export function activeTimeline(file: ProjectFile): Timeline {
  return file.timelines.find((t) => t.id === file.activeTimelineId) ?? file.timelines[0]!;
}

export function wrapLegacyTimeline(timeline: Timeline): ProjectFile {
  const t = ensureTimeline(timeline);
  return {
    timelines: [t],
    activeTimelineId: t.id!,
    openTimelineIds: [t.id!],
  };
}

export function nextNestName(existing: readonly Timeline[]): string {
  const used = new Set(existing.map((t) => t.name ?? ""));
  let n = 1;
  while (used.has(`Nest ${n}`)) n += 1;
  return `Nest ${n}`;
}

export function nextTimelineName(existing: readonly Timeline[]): string {
  const used = new Set(existing.map((t) => t.name ?? ""));
  let n = existing.length + 1;
  while (used.has(`Timeline ${n}`)) n += 1;
  return `Timeline ${n}`;
}

export function duplicateTimelineName(name: string, existing: readonly Timeline[]): string {
  const used = new Set(existing.map((t) => t.name ?? ""));
  const candidate = (n: number) => (n === 1 ? `${name} copy` : `${name} copy ${n}`);
  let n = 1;
  while (used.has(candidate(n))) n += 1;
  return candidate(n);
}
