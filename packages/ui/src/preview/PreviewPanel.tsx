import { useEffect, useRef, useState } from "react";
import { PlaybackEngine } from "@palmier/engine";
import type { MediaByteSource } from "@palmier/engine";
import type { EditorStore, Timeline } from "@palmier/core";
import { timelineTotalFrames } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { TransportBar } from "./TransportBar.js";

export interface PreviewPanelProps {
  store: EditorStore;
  media: MediaByteSource;
}

function snapshotSignature(tl: Timeline): string {
  const clipIds = tl.tracks
    .flatMap((t) => t.clips.map((c) => `${c.id}:${c.mediaRef}`))
    .join(",");
  return `${tl.tracks.length}|${clipIds}`;
}

export function PreviewPanel({ store, media }: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const mountedRef = useRef(false);
  const prevSigRef = useRef<string>("");
  const prevPlayheadRef = useRef<number>(0);
  const prevTimelineRef = useRef<Timeline | null>(null);
  // used to force a re-render when the engine becomes ready
  const [engineReady, setEngineReady] = useState(false);

  useEffect(() => {
    // StrictMode double-mount guard — only run once
    if (mountedRef.current) return;
    mountedRef.current = true;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: PlaybackEngine | null = null;
    let disposed = false;
    let unsub: (() => void) | null = null;

    async function init() {
      engine = await PlaybackEngine.create(canvas!);
      if (disposed) { engine.dispose(); return; }
      engineRef.current = engine;

      const snap = store.getSnapshot();
      prevSigRef.current = snapshotSignature(snap.timeline);
      prevTimelineRef.current = snap.timeline;
      prevPlayheadRef.current = snap.playhead;

      await engine.load(snap.timeline, media);
      if (disposed) { engine.dispose(); return; }

      // engine state → store playhead
      // the loop guard on the subscribe side prevents echoing back
      engine.onStateChange(({ currentFrame }) => {
        store.setPlayhead(currentFrame);
      });

      unsub = store.subscribe(async () => {
        if (!engine || disposed) return;
        const snap = store.getSnapshot();
        const prevTl = prevTimelineRef.current;
        const prevPlayhead = prevPlayheadRef.current;

        if (snap.timeline !== prevTl) {
          const newSig = snapshotSignature(snap.timeline);
          const oldSig = prevSigRef.current;
          prevSigRef.current = newSig;
          prevTimelineRef.current = snap.timeline;
          prevPlayheadRef.current = snap.playhead;

          if (newSig !== oldSig) {
            // structural change: tracks/clips added/removed or mediaRef changed
            await engine.setTimeline(snap.timeline);
          } else {
            // property-only change: seek if not playing
            if (!engine.isPlaying && snap.playhead !== engine.currentFrame) {
              await engine.seek(snap.playhead, "exact");
            }
          }
        } else if (snap.playhead !== prevPlayhead) {
          prevPlayheadRef.current = snap.playhead;
          // loop guard: don't echo the engine's own onStateChange updates back into seek
          if (!engine.isPlaying && snap.playhead !== engine.currentFrame) {
            await engine.seek(snap.playhead, "exact");
          }
        }
      });

      // Expose readPixel for E2E tests
      (canvas! as HTMLCanvasElement & { __readPixel?: (x: number, y: number) => Promise<[number, number, number, number]> }).__readPixel = (x, y) => engine.readPixel(x, y);
      canvas!.dataset["engineReady"] = "1";
      setEngineReady(true);
    }

    void init();

    return () => {
      disposed = true;
      unsub?.();
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
      mountedRef.current = false;
      setEngineReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = store.getSnapshot();
  const timeline = snap.timeline;
  const durationFrames = timelineTotalFrames(timeline);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#000",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "#000",
          minHeight: 0,
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
