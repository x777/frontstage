import { useEffect, useRef } from "react";
import {
  DEFAULT_TRACK_HEIGHT,
  RULER_HEIGHT,
  makeGeometry,
} from "@palmier/core";
import type { EditorStore } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { drawTimeline } from "./draw-timeline.js";
import type { TimelinePalette } from "./draw-timeline.js";

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

    // pointer: Task 4 (pointer down/move/up handlers go here, sharing geom + canvas rect for screen→frame)

    return () => {
      aborted = true;
      unsub();
      ro.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
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
