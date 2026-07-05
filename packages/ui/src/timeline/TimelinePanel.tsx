import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_TRACK_HEIGHT,
  RULER_HEIGHT,
  makeGeometry,
  frameAtX,
  xForFrame,
  trackAtY,
  timelineTotalFrames,
  clipTypesCompatible,
  collectTargets,
  findSnap,
  newSnapState,
  moveDelta,
  trimLeftDelta,
  trimRightDelta,
  moveClipCommand,
  splitClipCommand,
  splitLinkedClipCommand,
  removeClipCommand,
  addClipCommand,
  clipFromAsset,
  dropTargetAt,
  insertionLineY,
  clipRect,
  marqueeSelect,
  timelineRangeEdgeHit,
  rangeEdgeAnchorFrame,
  resolveDropPlan,
  planRippleInsertPreview,
  selectForwardAction,
  ZOOM_MIN as MIN_ZOOM,
  ZOOM_MAX as MAX_ZOOM,
} from "@palmier/core";
import type { RippleInsertPreviewPlan } from "@palmier/core";
import type { EditorStore, MediaManifestEntry } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { TrackHeaders, TRACK_HEADER_WIDTH } from "./TrackHeaders.js";
import { drawTimeline } from "./draw-timeline.js";
import type { TimelinePalette, DropIndicator, TimelineOverlays } from "./draw-timeline.js";
import { hitTest, trimTickCommand, selectForwardScopeForKey } from "./pointer.js";
import type { MediaDragController } from "../media/media-drag.js";
import { ClipContextMenu, type ClipContextMenuState } from "./ClipContextMenu.js";
import { useStore } from "../store/use-store.js";

const DRAG_THRESHOLD = 3;

// Duck-typed: TimelinePanel only needs to read entries + hear about changes (mirrors MediaPanel's library dep).
export interface TimelineLibraryLike {
  getSnapshot(): { entries: MediaManifestEntry[] };
  subscribe(cb: () => void): () => void;
}

export interface TimelinePanelProps {
  store: EditorStore;
  dragController?: MediaDragController;
  library?: TimelineLibraryLike;
}

/** mediaRef (= entry.id) → serialized generationStatus, entries without one omitted. */
export function generationStatusByRef(entries: MediaManifestEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.generationStatus !== undefined) map.set(entry.id, entry.generationStatus);
  }
  return map;
}

/** mediaRef (= entry.id) → display name, for the timeline clip label. */
export function mediaNameByRef(entries: MediaManifestEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) map.set(entry.id, entry.name);
  return map;
}

/** Read concrete color strings from CSS vars once. */
function resolvePalette(el: Element): TimelinePalette {
  const s = getComputedStyle(el);
  const get = (v: string) => s.getPropertyValue(v).trim();
  const getPx = (v: string, fallback: number) => {
    const n = parseFloat(get(v));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    bgBase: get("--bg-base") || "#0a0a0a",
    bgSurface: get("--bg-surface") || "#161616",
    bgRaised: get("--bg-raised") || "#1e1e1e",
    textPrimary: get("--text-primary") || "rgba(255,255,255,1)",
    textMuted: get("--text-muted") || "rgba(255,255,255,0.34)",
    textTertiary: get("--text-tertiary") || "rgba(255,255,255,0.62)",
    borderPrimary: get("--border-primary") || "rgba(255,255,255,0.16)",
    borderDivider: get("--border-divider") || "rgba(255,255,255,0.44)",
    accentTimecode: get("--accent-timecode") || "rgb(242,153,51)",
    accentPrimary: get("--accent-primary") || "rgb(245,239,228)",
    trackVideo: get("--track-video") || "#0091C2",
    trackAudio: get("--track-audio") || "#58A822",
    trackImage: get("--track-image") || "#B72DD2",
    trackText: get("--track-text") || "#B72DD2",
    trackLottie: get("--track-lottie") || "#E0A800",
    trimHandle: get("--color-timeline-trim-handle") || "rgba(255,255,255,0.34)",
    clipLabel: get("--color-timeline-clip-label") || "rgba(255,255,255,1)",
    generatingScrim: get("--color-timeline-generating-scrim") || "rgba(10,10,10,0.72)", // matches --color-timeline-generating-scrim
    failedScrim: get("--color-timeline-failed-scrim") || "rgba(229,79,79,0.55)", // matches --color-timeline-failed-scrim
    rulerLabelFontPx: get("--font-xs") || "10px",
    playhead: get("--color-timeline-playhead") || "rgb(255,69,58)",
    snapIndicator: get("--color-timeline-snap") || "rgb(255,214,10)",
    razorLine: get("--color-timeline-razor") || "rgba(255,159,10,0.8)",
    clipDetailMinWidth: getPx("--size-clip-detail-min", 32),
    clipLabelMinWidth: getPx("--size-clip-label-min", 56),
  };
}

export function TimelinePanel({ store, dragController, library }: TimelinePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const snapLineXRef = useRef<number | null>(null);
  const dropIndicatorRef = useRef<DropIndicator | null>(null);
  const ghostPreviewRef = useRef<RippleInsertPreviewPlan | null>(null);
  const marqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const razorPreviewFrameRef = useRef<number | null>(null);
  const razorSnapStateRef = useRef(newSnapState());
  const [menu, setMenu] = useState<ClipContextMenuState | null>(null);
  const toolMode = useStore(store, (s) => s.toolMode);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Resolve palette once from CSS vars on this element
    const palette = resolvePalette(canvas);

    let rafId: number | null = null;
    let aborted = false;
    let currentWidth = 0;
    let currentHeight = 0;
    let currentDpr = window.devicePixelRatio || 1;

    function draw() {
      rafId = null;
      if (aborted) return;
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;

      if (currentWidth === 0 || currentHeight === 0) return;

      const snap = store.getSnapshot();
      const { view, timeline } = snap;
      const geom = makeGeometry({
        pixelsPerFrame: view.zoom,
        scrollX: view.scrollX,
        headerWidth: TRACK_HEADER_WIDTH,
        trackHeights: timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
      });

      // Leaving razor mode invalidates any live preview — cheapest correct point to drop it.
      if (snap.toolMode !== "razor" && razorPreviewFrameRef.current !== null) {
        razorPreviewFrameRef.current = null;
        razorSnapStateRef.current = newSnapState();
      }
      const razorLineX =
        snap.toolMode === "razor" && razorPreviewFrameRef.current !== null
          ? xForFrame(geom, razorPreviewFrameRef.current)
          : null;

      // Build overlays: marquee + range band + ghost-insert preview
      const overlays: TimelineOverlays = {};
      if (marqueeRectRef.current) {
        overlays.marquee = marqueeRectRef.current;
      }
      const snapRange = snap.selectedTimelineRange;
      if (snapRange) {
        const lo = Math.min(snapRange.startFrame, snapRange.endFrame);
        const hi = Math.max(snapRange.startFrame, snapRange.endFrame);
        if (lo !== hi) {
          overlays.rangeBand = { startX: xForFrame(geom, lo), endX: xForFrame(geom, hi) };
        }
      }
      if (ghostPreviewRef.current) {
        overlays.ghostInsert = ghostPreviewRef.current;
      }

      const libraryEntries = library?.getSnapshot().entries;
      const statusByRef = libraryEntries ? generationStatusByRef(libraryEntries) : undefined;
      const nameByRef = libraryEntries ? mediaNameByRef(libraryEntries) : undefined;

      drawTimeline(ctx, snap, geom, { width: currentWidth, height: currentHeight, dpr: currentDpr }, palette, snapLineXRef.current, dropIndicatorRef.current, overlays, statusByRef, nameByRef, razorLineX);
    }

    function scheduleDraw() {
      if (aborted) return;
      if (rafId === null) {
        rafId = requestAnimationFrame(draw);
      }
    }

    function applySize(w: number, h: number) {
      const cv = canvasRef.current;
      if (!cv || w === 0 || h === 0) return;
      const dpr = window.devicePixelRatio || 1;
      currentWidth = w;
      currentHeight = h;
      currentDpr = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      scheduleDraw();
    }

    // Initial size
    const initialRect = container.getBoundingClientRect();
    const initialW = initialRect.width || container.offsetWidth;
    const initialH = initialRect.height || container.offsetHeight;
    applySize(initialW, initialH);

    // ResizeObserver for layout changes
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        applySize(width, height);
      }
    });
    ro.observe(container);

    // Store subscription — rAF-coalesced redraw
    const unsub = store.subscribe(scheduleDraw);
    // Library subscription — redraws the generating/failed clip scrim when a job finalizes or fails
    const unsubLibrary = library ? library.subscribe(scheduleDraw) : null;

    // pointer: scrub + drag gestures (move, trim)
    let scrubbing = false;

    // Marquee drag state
    type MarqueeState = { originX: number; originY: number; base: ReadonlySet<string>; moved: boolean };
    let marquee: MarqueeState | null = null;

    // Range drag state (shift+ruler)
    type RangeDragState = { anchorFrame: number };
    let rangeDrag: RangeDragState | null = null;

    // Drag state (move or trim)
    type DragKind = "move" | "trim-left" | "trim-right";
    type DragState = {
      kind: DragKind;
      clipId: string;
      trackIndex: number;
      pointerId: number;
      downX: number;
      downY: number;
      started: boolean;
      // move
      grabOffsetFrames: number;
      originalFrame: number;
      originalTrackIndex: number;
      // trim
      originalDuration: number;
      originalTrimStart: number;
      originalTrimEnd: number;
      originalStartFrame: number;
      hasNoSourceMedia: boolean;
      snapState: ReturnType<typeof newSnapState>;
      // ripple trim (shift held at drag start; fixed for the gesture, like Swift's isRipple)
      isRipple: boolean;
      lastAbsoluteDelta: number;
    } | null;

    let drag: DragState = null;

    function getGeomAndCoords(e: PointerEvent | WheelEvent): { geom: ReturnType<typeof makeGeometry>; x: number; y: number } | null {
      const cv = canvasRef.current;
      if (!cv) return null;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const snap = store.getSnapshot();
      const geom = makeGeometry({
        pixelsPerFrame: snap.view.zoom,
        scrollX: snap.view.scrollX,
        headerWidth: TRACK_HEADER_WIDTH,
        trackHeights: snap.timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
      });
      return { geom, x, y };
    }

    function onPointerDown(e: PointerEvent) {
      const cv = canvasRef.current;
      if (!cv) return;
      const coords = getGeomAndCoords(e);
      if (!coords) return;
      const { geom, x, y } = coords;
      const snap = store.getSnapshot();
      const hit = hitTest(snap, geom, x, y);

      if (hit.kind === "ruler") {
        if (e.shiftKey) {
          // Shift+ruler: begin range drag
          const currentRange = snap.selectedTimelineRange;
          let anchorFrame: number;
          if (currentRange) {
            const edge = timelineRangeEdgeHit(geom, x, currentRange);
            anchorFrame = edge ? rangeEdgeAnchorFrame(currentRange, edge) : frameAtX(geom, x);
          } else {
            anchorFrame = frameAtX(geom, x);
          }
          store.setSelectedTimelineRange({ startFrame: anchorFrame, endFrame: anchorFrame });
          store.select([]);
          rangeDrag = { anchorFrame };
          cv.setPointerCapture(e.pointerId);
        } else {
          scrubbing = true;
          cv.setPointerCapture(e.pointerId);
          store.setPlayhead(frameAtX(geom, x));
        }
      } else if (snap.toolMode === "razor") {
        // Razor: splits the hit clip only — no selection change, no drags (mirrors Swift's
        // TimelineInputController early return; ruler clicks above still scrub/range-select).
        if (hit.kind === "clip") {
          const frame = razorPreviewFrameRef.current ?? frameAtX(geom, x);
          store.dispatch(splitLinkedClipCommand(hit.clipId, frame));
          scheduleDraw();
        }
      } else if (hit.kind === "clip") {
        // Always select on pointerdown
        store.select([hit.clipId]);

        const tracks = snap.timeline.tracks;
        const track = tracks[hit.trackIndex];
        const clip = track?.clips.find((c) => c.id === hit.clipId);
        if (!clip) return;

        const hasNoSourceMedia = clip.mediaType === "image" || clip.mediaType === "text";

        if (hit.edge === "left" || hit.edge === "right") {
          // Start a trim drag
          cv.setPointerCapture(e.pointerId);
          drag = {
            kind: hit.edge === "left" ? "trim-left" : "trim-right",
            clipId: hit.clipId,
            trackIndex: hit.trackIndex,
            pointerId: e.pointerId,
            downX: x,
            downY: y,
            started: false,
            grabOffsetFrames: 0,
            originalFrame: clip.startFrame,
            originalTrackIndex: hit.trackIndex,
            originalDuration: clip.durationFrames,
            originalTrimStart: clip.trimStartFrame,
            originalTrimEnd: clip.trimEndFrame,
            originalStartFrame: clip.startFrame,
            hasNoSourceMedia,
            snapState: newSnapState(),
            isRipple: e.shiftKey,
            lastAbsoluteDelta: 0,
          };
        } else {
          // Clip body — start a move drag (DRAG_THRESHOLD before dispatching)
          cv.setPointerCapture(e.pointerId);
          const cursorFrame = frameAtX(geom, x);
          drag = {
            kind: "move",
            clipId: hit.clipId,
            trackIndex: hit.trackIndex,
            pointerId: e.pointerId,
            downX: x,
            downY: y,
            started: false,
            grabOffsetFrames: cursorFrame - clip.startFrame,
            originalFrame: clip.startFrame,
            originalTrackIndex: hit.trackIndex,
            originalDuration: clip.durationFrames,
            originalTrimStart: clip.trimStartFrame,
            originalTrimEnd: clip.trimEndFrame,
            originalStartFrame: clip.startFrame,
            hasNoSourceMedia,
            snapState: newSnapState(),
            isRipple: false,
            lastAbsoluteDelta: 0,
          };
        }
      } else {
        // Empty area — begin marquee
        const base: ReadonlySet<string> = e.shiftKey ? new Set(snap.selection) : new Set<string>();
        marquee = { originX: x, originY: y, base, moved: false };
        cv.setPointerCapture(e.pointerId);
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (scrubbing) {
        const coords = getGeomAndCoords(e);
        if (!coords) return;
        const { geom, x } = coords;
        store.setPlayhead(frameAtX(geom, x));
        return;
      }

      if (rangeDrag) {
        const coords = getGeomAndCoords(e);
        if (!coords) return;
        const { geom, x } = coords;
        store.setSelectedTimelineRange({ startFrame: rangeDrag.anchorFrame, endFrame: frameAtX(geom, x) });
        scheduleDraw();
        return;
      }

      if (marquee) {
        marquee.moved = true;
        const coords = getGeomAndCoords(e);
        if (!coords) return;
        const { geom, x, y } = coords;
        // Normalized marquee rect (always positive width/height)
        const rx = Math.min(marquee.originX, x);
        const ry = Math.min(marquee.originY, y);
        const rw = Math.abs(x - marquee.originX);
        const rh = Math.abs(y - marquee.originY);
        marqueeRectRef.current = { x: rx, y: ry, width: rw, height: rh };
        const snap2 = store.getSnapshot();
        store.select(marqueeSelect(snap2.timeline, geom, { x: rx, y: ry, width: rw, height: rh }, marquee.base, !e.altKey));
        scheduleDraw();
        return;
      }

      if (!drag) {
        // Hover path — no gesture in progress. Only razor mode cares (snapped split-line preview).
        const coords = getGeomAndCoords(e);
        if (!coords) return;
        const { geom, x, y } = coords;
        const snap = store.getSnapshot();
        if (snap.toolMode === "razor" && y >= RULER_HEIGHT) {
          const candidate = frameAtX(geom, x);
          const targets = collectTargets(snap.timeline.tracks, { playheadFrame: snap.playhead, includePlayhead: true });
          const snapResult = findSnap({
            position: candidate,
            targets,
            state: razorSnapStateRef.current,
            baseThresholdPx: 8,
            pixelsPerFrame: geom.pixelsPerFrame,
          });
          const next = snapResult ? snapResult.frame : candidate;
          if (razorPreviewFrameRef.current !== next) {
            razorPreviewFrameRef.current = next;
            scheduleDraw();
          }
        } else if (razorPreviewFrameRef.current !== null) {
          razorPreviewFrameRef.current = null;
          razorSnapStateRef.current = newSnapState();
          scheduleDraw();
        }
        return;
      }

      const coords = getGeomAndCoords(e);
      if (!coords) return;
      const { geom, x, y } = coords;

      const dx = x - drag.downX;
      if (!drag.started && Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.started = true;

      const snap = store.getSnapshot();
      const tracks = snap.timeline.tracks;
      const playheadFrame = snap.playhead;

      if (drag.kind === "move") {
        const cursorFrame = frameAtX(geom, x);
        const targets = collectTargets(tracks, {
          playheadFrame,
          excludeClipIds: new Set([drag.clipId]),
          includePlayhead: true,
        });
        const snapResult = findSnap({
          position: cursorFrame - drag.grabOffsetFrames,
          probeOffsets: [0, drag.originalDuration],
          targets,
          state: drag.snapState,
          baseThresholdPx: 8,
          pixelsPerFrame: geom.pixelsPerFrame,
        });
        const delta = moveDelta({
          cursorFrame,
          grabOffsetFrames: drag.grabOffsetFrames,
          originalFrame: drag.originalFrame,
          minOriginalFrame: drag.originalFrame,
          snap: snapResult,
        });

        // Determine target track (clamp to compatible)
        let toTrack = trackAtY(geom, y);
        const srcTrackType = tracks[drag.originalTrackIndex]?.type;
        const destTrack = tracks[toTrack];
        if (!destTrack || !srcTrackType || !clipTypesCompatible(destTrack.type, srcTrackType)) {
          toTrack = drag.originalTrackIndex;
        }

        store.dispatch(moveClipCommand(drag.clipId, toTrack, drag.originalFrame + delta, "move-" + drag.clipId));

        // Update snap line (content px → screen px)
        if (snapResult) {
          snapLineXRef.current = xForFrame(geom, snapResult.frame);
        } else {
          snapLineXRef.current = null;
        }
        scheduleDraw();
      } else if (drag.kind === "trim-left") {
        const cursorFrame = frameAtX(geom, x);
        const targets = collectTargets(tracks, {
          playheadFrame,
          excludeClipIds: new Set([drag.clipId]),
          includePlayhead: true,
        });
        const snapResult = findSnap({
          position: cursorFrame,
          probeOffsets: [0],
          targets,
          state: drag.snapState,
          baseThresholdPx: 8,
          pixelsPerFrame: geom.pixelsPerFrame,
        });
        const snappedStartFrame = snapResult ? snapResult.frame : cursorFrame;
        const delta = trimLeftDelta({
          snappedStartFrame,
          originalStartFrame: drag.originalStartFrame,
          originalDuration: drag.originalDuration,
          originalTrimStart: drag.originalTrimStart,
          hasNoSourceMedia: drag.hasNoSourceMedia,
        });
        store.dispatch(trimTickCommand(drag.clipId, "left", delta, drag.isRipple, drag.lastAbsoluteDelta, "trim-" + drag.clipId));
        drag.lastAbsoluteDelta = delta;

        if (snapResult) {
          snapLineXRef.current = xForFrame(geom, snapResult.frame);
        } else {
          snapLineXRef.current = null;
        }
        scheduleDraw();
      } else if (drag.kind === "trim-right") {
        const cursorFrame = frameAtX(geom, x);
        const targets = collectTargets(tracks, {
          playheadFrame,
          excludeClipIds: new Set([drag.clipId]),
          includePlayhead: true,
        });
        const snapResult = findSnap({
          position: cursorFrame,
          probeOffsets: [0],
          targets,
          state: drag.snapState,
          baseThresholdPx: 8,
          pixelsPerFrame: geom.pixelsPerFrame,
        });
        const snappedEndFrame = snapResult ? snapResult.frame : cursorFrame;
        const delta = trimRightDelta({
          snappedEndFrame,
          originalStartFrame: drag.originalStartFrame,
          originalDuration: drag.originalDuration,
          originalTrimEnd: drag.originalTrimEnd,
          hasNoSourceMedia: drag.hasNoSourceMedia,
        });
        store.dispatch(trimTickCommand(drag.clipId, "right", delta, drag.isRipple, drag.lastAbsoluteDelta, "trim-" + drag.clipId));
        drag.lastAbsoluteDelta = delta;

        if (snapResult) {
          snapLineXRef.current = xForFrame(geom, snapResult.frame);
        } else {
          snapLineXRef.current = null;
        }
        scheduleDraw();
      }
    }

    function onPointerLeave() {
      // No pointermove fires once the cursor is off the canvas — drop a stale razor preview.
      if (razorPreviewFrameRef.current !== null) {
        razorPreviewFrameRef.current = null;
        razorSnapStateRef.current = newSnapState();
        scheduleDraw();
      }
    }

    function onPointerUpOrCancel(e: PointerEvent) {
      if (scrubbing) {
        scrubbing = false;
        const cv = canvasRef.current;
        if (cv) cv.releasePointerCapture(e.pointerId);
        return;
      }

      if (rangeDrag) {
        rangeDrag = null;
        store.keepValidTimelineRangeOrClear();
        const cv = canvasRef.current;
        if (cv) cv.releasePointerCapture(e.pointerId);
        scheduleDraw();
        return;
      }

      if (marquee) {
        if (!marquee.moved) store.select([]);
        marquee = null;
        marqueeRectRef.current = null;
        const cv = canvasRef.current;
        if (cv) cv.releasePointerCapture(e.pointerId);
        scheduleDraw();
        return;
      }

      if (drag && drag.pointerId === e.pointerId) {
        drag = null;
        snapLineXRef.current = null;
        // Every drag-gesture family (move, trim, ripple-trim) ends its coalesce run here — mirrors
        // reorder's unconditional setSelectedGap(null) — so a follow-up gesture on the same clip
        // edge (re-selecting an already-selected clip is a no-op, unlike reorder's gap reset)
        // starts its own undo entry instead of merging into this one's.
        store.breakCoalescing();
        const cv = canvasRef.current;
        if (cv) cv.releasePointerCapture(e.pointerId);
        scheduleDraw();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const forwardScope = selectForwardScopeForKey(e);
      if (forwardScope) {
        e.preventDefault();
        selectForwardAction(store, forwardScope);
        return;
      }

      if (e.key === "s" || e.key === "b" || e.key === "S" || e.key === "B") {
        const snap = store.getSnapshot();
        const playhead = snap.playhead;
        for (const track of snap.timeline.tracks) {
          for (const clip of track.clips) {
            if (snap.selection.has(clip.id) && playhead > clip.startFrame && playhead < clip.startFrame + clip.durationFrames) {
              store.dispatch(splitClipCommand(clip.id, playhead, "split-" + clip.id + "-" + playhead));
            }
          }
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const snap = store.getSnapshot();
        const ids = [...snap.selection];
        if (ids.length === 0) return;
        e.preventDefault();
        // Track ids that hold a selected clip — prune those if this delete empties them.
        const affected = new Set(
          snap.timeline.tracks.filter((tr) => tr.clips.some((c) => snap.selection.has(c.id))).map((tr) => tr.id),
        );
        store.dispatch({
          label: "Delete",
          apply: (tl) => {
            const removed = ids.reduce((t, id) => removeClipCommand(id).apply(t), tl);
            return { ...removed, tracks: removed.tracks.filter((tr) => !(affected.has(tr.id) && tr.clips.length === 0)) };
          },
        });
        store.select([]);
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const coords = getGeomAndCoords(e);
      if (!coords) return;
      const { geom, x } = coords;
      const snap = store.getSnapshot();

      if (e.ctrlKey || e.metaKey) {
        // zoom, anchor at cursor frame
        const frameUnderCursor = frameAtX(geom, x);
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, snap.view.zoom * Math.exp(-e.deltaY * 0.001)));
        const newScrollX = Math.max(0, frameUnderCursor * newZoom - (x - TRACK_HEADER_WIDTH));
        store.setZoom(newZoom);
        store.setScroll(newScrollX);
      } else {
        // horizontal scroll
        const totalFrames = timelineTotalFrames(snap.timeline);
        const contentWidth = totalFrames * snap.view.zoom;
        const maxScrollX = Math.max(0, contentWidth - currentWidth);
        store.setScroll(Math.min(maxScrollX, Math.max(0, snap.view.scrollX + e.deltaY)));
      }
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      const cv = canvasRef.current;
      if (!cv) return;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const snap = store.getSnapshot();
      const geom = makeGeometry({
        pixelsPerFrame: snap.view.zoom,
        scrollX: snap.view.scrollX,
        headerWidth: TRACK_HEADER_WIDTH,
        trackHeights: snap.timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
      });
      const hit = hitTest(snap, geom, x, y);
      if (hit.kind === "clip") {
        if (!snap.selection.has(hit.clipId)) {
          store.select([hit.clipId]);
        }
        const containerRect = containerRef.current!.getBoundingClientRect();
        setMenu({ x: e.clientX - containerRect.left, y: e.clientY - containerRect.top, clipId: hit.clipId });
      } else {
        setMenu(null);
      }
    }

    function onDocClick() {
      setMenu(null);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUpOrCancel);
    canvas.addEventListener("pointercancel", onPointerUpOrCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.setAttribute("tabindex", "0");
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("click", onDocClick);

    // Media drag drop indicator + drop handler
    let unsubDrag: (() => void) | null = null;
    if (dragController) {
      const onDragChange = () => {
        const dragSnap = dragController.getSnapshot();
        const cv = canvasRef.current;
        if (!cv || !dragSnap) {
          dropIndicatorRef.current = null;
          ghostPreviewRef.current = null;
          scheduleDraw();
          return;
        }
        const rect = cv.getBoundingClientRect();
        const lx = dragSnap.x - rect.left;
        const ly = dragSnap.y - rect.top;
        if (lx < 0 || lx > rect.width || ly < 0 || ly > rect.height) {
          dropIndicatorRef.current = null;
          ghostPreviewRef.current = null;
        } else {
          const snap2 = store.getSnapshot();
          const geomDrop = makeGeometry({
            pixelsPerFrame: snap2.view.zoom,
            scrollX: snap2.view.scrollX,
            headerWidth: TRACK_HEADER_WIDTH,
            trackHeights: snap2.timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
          });
          const target = dropTargetAt(geomDrop, ly);
          const dropFrame = frameAtX(geomDrop, lx);
          if (dragSnap.ripple) {
            // Ripple mode: show ghost-insert preview (gaps + shifts)
            dropIndicatorRef.current = null;
            const entry = dragSnap.entry;
            const fps = snap2.timeline.fps;
            const durationFrames = Math.max(1, Math.round((entry.duration ?? 0) * fps));
            const plan = resolveDropPlan(snap2.timeline, target, entry.type, entry.hasAudio === true, durationFrames);
            ghostPreviewRef.current = planRippleInsertPreview(snap2.timeline, plan, dropFrame);
          } else {
            // Non-ripple: show existing single ghost-clip / insertion-line indicator
            ghostPreviewRef.current = null;
            if (target.kind === "new") {
              const lineY = insertionLineY(geomDrop, target);
              dropIndicatorRef.current = lineY !== null
                ? { kind: "insertion-line", y: lineY }
                : null;
            } else {
              const ghostClip = clipFromAsset(dragSnap.entry, snap2.timeline.fps, dropFrame);
              const r = clipRect(geomDrop, ghostClip, target.index);
              dropIndicatorRef.current = { kind: "ghost-clip", x: r.x, y: r.y, width: r.width, height: r.height };
            }
          }
        }
        scheduleDraw();
      };
      unsubDrag = dragController.subscribe(onDragChange);
    }

    return () => {
      aborted = true;
      unsub();
      if (unsubLibrary) unsubLibrary();
      if (unsubDrag) unsubDrag();
      ro.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUpOrCancel);
      canvas.removeEventListener("pointercancel", onPointerUpOrCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("click", onDocClick);
    };
  }, [store, dragController, library]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: theme.bg.base,
        position: "relative",
      }}
    >
      <TrackHeaders store={store} />
      <canvas
        ref={canvasRef}
        data-testid="timeline-canvas"
        style={{ display: "block", cursor: toolMode === "razor" ? "crosshair" : undefined }}
      />
      <ClipContextMenu store={store} menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
