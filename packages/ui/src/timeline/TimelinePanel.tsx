import { useEffect, useRef } from "react";
import {
  DEFAULT_TRACK_HEIGHT,
  RULER_HEIGHT,
  TIMELINE_HEADER_WIDTH,
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
  trimClipCommand,
  splitClipCommand,
  addClipCommand,
  clipFromAsset,
  dropTargetAt,
  insertionLineY,
  clipRect,
} from "@palmier/core";
import type { EditorStore } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { drawTimeline } from "./draw-timeline.js";
import type { TimelinePalette, DropIndicator } from "./draw-timeline.js";
import { hitTest } from "./pointer.js";
import type { MediaDragController } from "../media/media-drag.js";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 40;
const DRAG_THRESHOLD = 3;

export interface TimelinePanelProps {
  store: EditorStore;
  dragController?: MediaDragController;
}

/** Read concrete color strings from CSS vars once. */
function resolvePalette(el: Element): TimelinePalette {
  const s = getComputedStyle(el);
  const get = (v: string) => s.getPropertyValue(v).trim();
  return {
    bgBase: get("--bg-base") || "#0a0a0a",
    bgSurface: get("--bg-surface") || "#161616",
    bgRaised: get("--bg-raised") || "#1e1e1e",
    textPrimary: get("--text-primary") || "rgba(255,255,255,1)",
    textMuted: get("--text-muted") || "rgba(255,255,255,0.34)",
    borderDivider: get("--border-divider") || "rgba(255,255,255,0.44)",
    accentTimecode: get("--accent-timecode") || "rgb(242,153,51)",
    accentPrimary: get("--accent-primary") || "rgb(245,239,228)",
    trackVideo: get("--track-video") || "#0091C2",
    trackAudio: get("--track-audio") || "#58A822",
    trackImage: get("--track-image") || "#B72DD2",
    trackText: get("--track-text") || "#B72DD2",
    trackLottie: get("--track-lottie") || "#E0A800",
    trimHandle: get("--color-timeline-trim-handle") || "rgba(0,0,0,0.25)",
    clipLabel: get("--color-timeline-clip-label") || "rgba(255,255,255,0.85)",
  };
}

export function TimelinePanel({ store, dragController }: TimelinePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const snapLineXRef = useRef<number | null>(null);
  const dropIndicatorRef = useRef<DropIndicator | null>(null);

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
        headerWidth: TIMELINE_HEADER_WIDTH,
        trackHeights: timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
      });

      drawTimeline(ctx, snap, geom, { width: currentWidth, height: currentHeight, dpr: currentDpr }, palette, snapLineXRef.current, dropIndicatorRef.current);
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

    // pointer: scrub + drag gestures (move, trim)
    let scrubbing = false;

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
        headerWidth: TIMELINE_HEADER_WIDTH,
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
        scrubbing = true;
        cv.setPointerCapture(e.pointerId);
        store.setPlayhead(frameAtX(geom, x));
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
          };
        }
      } else {
        store.select([]);
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

      if (!drag) return;

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
        store.dispatch(trimClipCommand(drag.clipId, "left", delta, "trim-" + drag.clipId));

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
        store.dispatch(trimClipCommand(drag.clipId, "right", delta, "trim-" + drag.clipId));

        if (snapResult) {
          snapLineXRef.current = xForFrame(geom, snapResult.frame);
        } else {
          snapLineXRef.current = null;
        }
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

      if (drag && drag.pointerId === e.pointerId) {
        drag = null;
        snapLineXRef.current = null;
        const cv = canvasRef.current;
        if (cv) cv.releasePointerCapture(e.pointerId);
        scheduleDraw();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
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
        const newScrollX = Math.max(0, frameUnderCursor * newZoom - (x - TIMELINE_HEADER_WIDTH));
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

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUpOrCancel);
    canvas.addEventListener("pointercancel", onPointerUpOrCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.setAttribute("tabindex", "0");
    canvas.addEventListener("keydown", onKeyDown);

    // Media drag drop indicator + drop handler
    let unsubDrag: (() => void) | null = null;
    if (dragController) {
      const onDragChange = () => {
        const dragSnap = dragController.getSnapshot();
        const cv = canvasRef.current;
        if (!cv || !dragSnap) {
          dropIndicatorRef.current = null;
          scheduleDraw();
          return;
        }
        const rect = cv.getBoundingClientRect();
        const lx = dragSnap.x - rect.left;
        const ly = dragSnap.y - rect.top;
        if (lx < 0 || lx > rect.width || ly < 0 || ly > rect.height) {
          dropIndicatorRef.current = null;
        } else {
          const snap2 = store.getSnapshot();
          const geomDrop = makeGeometry({
            pixelsPerFrame: snap2.view.zoom,
            scrollX: snap2.view.scrollX,
            headerWidth: TIMELINE_HEADER_WIDTH,
            trackHeights: snap2.timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
            dropZoneHeight: 8,
          });
          const target = dropTargetAt(geomDrop, ly);
          const dropFrame = frameAtX(geomDrop, lx);
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
        scheduleDraw();
      };
      unsubDrag = dragController.subscribe(onDragChange);
    }

    return () => {
      aborted = true;
      unsub();
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
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
    };
  }, [store, dragController]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <canvas
        ref={canvasRef}
        data-testid="timeline-canvas"
        style={{ display: "block" }}
      />
    </div>
  );
}
