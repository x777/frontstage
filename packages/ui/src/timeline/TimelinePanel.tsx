import { useEffect, useRef } from "react";
import {
  DEFAULT_TRACK_HEIGHT,
  RULER_HEIGHT,
  makeGeometry,
  frameAtX,
  timelineTotalFrames,
} from "@palmier/core";
import type { EditorStore } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { drawTimeline } from "./draw-timeline.js";
import type { TimelinePalette } from "./draw-timeline.js";
import { hitTest } from "./pointer.js";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 40;

export interface TimelinePanelProps {
  store: EditorStore;
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

export function TimelinePanel({ store }: TimelinePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      // EditorView.zoom is defined as pixels-per-frame, matching makeGeometry's pixelsPerFrame
      const geom = makeGeometry({
        pixelsPerFrame: view.zoom,
        scrollX: view.scrollX,
        headerWidth: 0,
        trackHeights: timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
      });

      drawTimeline(ctx, snap, geom, { width: currentWidth, height: currentHeight, dpr: currentDpr }, palette);
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

    // pointer: Task 4 — select, scrub, zoom, scroll
    let scrubbing = false;

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
        headerWidth: 0,
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
        store.select([hit.clipId]);
      } else {
        store.select([]);
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!scrubbing) return;
      const coords = getGeomAndCoords(e);
      if (!coords) return;
      const { geom, x } = coords;
      store.setPlayhead(frameAtX(geom, x));
    }

    function onPointerUpOrCancel(e: PointerEvent) {
      if (!scrubbing) return;
      scrubbing = false;
      const cv = canvasRef.current;
      if (cv) cv.releasePointerCapture(e.pointerId);
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
        const newScrollX = Math.max(0, frameUnderCursor * newZoom - (x - 0 /* headerWidth */));
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

    return () => {
      aborted = true;
      unsub();
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
    };
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

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
