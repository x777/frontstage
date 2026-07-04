import { useEffect, useRef, useState } from "react";
import { PlaybackEngine } from "@palmier/engine";
import type { MediaByteSource } from "@palmier/engine";
import type { EditorStore, Timeline } from "@palmier/core";
import { timelineTotalFrames } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { TransportBar } from "./TransportBar.js";
import { TransformOverlay } from "./TransformOverlay.js";
import { CropOverlay } from "./CropOverlay.js";
import { useStore } from "../store/use-store.js";
import { selectClipAtPreviewPoint } from "./preview-hit-test.js";

export interface PreviewPanelProps {
  store: EditorStore;
  media: MediaByteSource;
  engineRef?: { current: PlaybackEngine | null };
}

function snapshotSignature(tl: Timeline): string {
  const clipIds = tl.tracks
    .flatMap((t) => t.clips.map((c) => `${c.id}:${c.mediaRef}`))
    .join(",");
  return `${tl.tracks.length}|${clipIds}`;
}

export function PreviewPanel({ store, media, engineRef: engineRefProp }: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const mountedRef = useRef(false);
  // Shared abort token: init reads this ref; cleanup sets it; second StrictMode mount resets it.
  const abortRef = useRef(false);
  const prevSigRef = useRef<string>("");
  const prevPlayheadRef = useRef<number>(0);
  const prevTimelineRef = useRef<Timeline | null>(null);
  // Tracks the last frame we called engine.seek() for synchronously, so rapid scrub
  // events don't each enqueue a full decode before engine.currentFrame updates.
  const intendedFrameRef = useRef<number>(0);
  // used to force a re-render when the engine becomes ready
  const [engineReady, setEngineReady] = useState(false);
  const [canvasRect, setCanvasRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    // StrictMode double-mount guard: mountedRef stays true so the re-invoke doesn't create a
    // second PlaybackEngine. On the re-invoke we only reset abortRef so the shared init can
    // continue; the async work stays in the first closure, guarded by abortRef.
    if (mountedRef.current) {
      // StrictMode second invoke: cancel the abort signal so the in-flight init proceeds.
      abortRef.current = false;
      return;
    }
    mountedRef.current = true;
    abortRef.current = false;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: PlaybackEngine | null = null;
    let unsub: (() => void) | null = null;

    async function init() {
      engine = await PlaybackEngine.create(canvas!);
      if (abortRef.current) { engine.dispose(); return; }
      engineRef.current = engine;
      if (engineRefProp) engineRefProp.current = engine;

      const snap = store.getSnapshot();
      prevSigRef.current = snapshotSignature(snap.timeline);
      prevTimelineRef.current = snap.timeline;
      prevPlayheadRef.current = snap.playhead;

      await engine.load(snap.timeline, media);
      if (abortRef.current) { engine.dispose(); return; }

      // engine state → store playhead
      // the loop guard on the subscribe side prevents echoing back
      engine.onStateChange(({ currentFrame }) => {
        intendedFrameRef.current = currentFrame;
        store.setPlayhead(currentFrame);
      });

      unsub = store.subscribe(async () => {
        if (!engine || abortRef.current) return;
        const snap = store.getSnapshot();
        const prevTl = prevTimelineRef.current;
        const prevPlayhead = prevPlayheadRef.current;

        if (snap.timeline !== prevTl) {
          const newSig = snapshotSignature(snap.timeline);
          const oldSig = prevSigRef.current;
          prevSigRef.current = newSig;
          prevTimelineRef.current = snap.timeline;
          prevPlayheadRef.current = snap.playhead; // always update — prevents stale seek on next emit

          // Always push the updated timeline so coordinator.timeline stays current.
          // reconcile() is cheap when sources are unchanged (property-only diff).
          await engine.setTimeline(snap.timeline);
          if (newSig === oldSig && !engine.isPlaying) {
            // property-only change: re-render at the current playhead with new properties
            await engine.seek(snap.playhead, "exact");
          }
        } else if (snap.playhead !== prevPlayhead) {
          prevPlayheadRef.current = snap.playhead;
          // loop guard: guard against intendedFrameRef (set synchronously) so rapid scrub
          // events don't each enqueue a decode before engine.currentFrame updates async.
          if (!engine.isPlaying && snap.playhead !== intendedFrameRef.current) {
            intendedFrameRef.current = snap.playhead;
            engine.seek(snap.playhead, "scrub").catch(() => {});
          }
        }
      });

      // Expose readPixel for E2E tests
      (canvas! as HTMLCanvasElement & { __readPixel?: (x: number, y: number) => Promise<[number, number, number, number]> }).__readPixel = (x, y) => engine!.readPixel(x, y);
      canvas!.dataset["engineReady"] = "1";
      setEngineReady(true);
    }

    void init();

    return () => {
      // Signal abort; StrictMode's second invoke (above) immediately resets this to false,
      // so in-flight init sees abort=false and continues. A real unmount leaves it true.
      abortRef.current = true;
      unsub?.();
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
      if (engineRefProp) engineRefProp.current = null;
      setEngineReady(false);
      // Do NOT reset mountedRef — the StrictMode re-invoke path above handles the reset.
      // A real unmount destroys this component instance and its refs.
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the canvas displayed rect for overlay positioning
  useEffect(() => {
    const container = overlayContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    function measure() {
      const containerRect = container!.getBoundingClientRect();
      const cvRect = canvas!.getBoundingClientRect();
      setCanvasRect({
        left: cvRect.left - containerRect.left,
        top: cvRect.top - containerRect.top,
        width: cvRect.width,
        height: cvRect.height,
      });
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Double-click the preview -> select the topmost clip under the point at the current frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onDoubleClick(e: MouseEvent): void {
      const engine = engineRef.current;
      const cv = canvasRef.current;
      if (!engine || !cv) return;
      const rect = cv.getBoundingClientRect();
      selectClipAtPreviewPoint(store, engine.sourceSizes(), { x: e.clientX, y: e.clientY }, rect);
    }

    canvas.addEventListener("dblclick", onDoubleClick);
    return () => canvas.removeEventListener("dblclick", onDoubleClick);
  }, [store]);

  const timeline = useStore(store, (s) => s.timeline);
  const durationFrames = timelineTotalFrames(timeline);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.bg.previewLetterbox,
      }}
    >
      <div
        ref={overlayContainerRef}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: theme.bg.previewLetterbox,
          minHeight: 0,
          position: "relative",
        }}
      >
        <canvas
          ref={canvasRef}
          data-testid="preview-canvas"
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
          }}
          width={timeline.width}
          height={timeline.height}
        />
        <div
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          data-testid="overlay-container"
        >
          {canvasRect && <TransformOverlay store={store} canvasRect={canvasRect} />}
          {canvasRect && <CropOverlay store={store} canvasRect={canvasRect} />}
        </div>
      </div>
      {engineReady && engineRef.current ? (
        <TransportBar
          engine={engineRef.current}
          store={store}
          fps={timeline.fps}
          durationFrames={durationFrames}
        />
      ) : (
        <div
          style={{
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            background: theme.bg.prominent,
            borderTop: `${theme.borderWidth.thin} solid ${theme.border.divider}`,
            fontSize: theme.fontSize.xs,
            color: theme.text.muted,
            flexShrink: 0,
          }}
        >
          Loading…
        </div>
      )}
    </div>
  );
}
