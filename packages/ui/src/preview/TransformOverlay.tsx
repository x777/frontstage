import { useCallback, useRef } from "react";
import type { EditorStore } from "@palmier/core";
import { transformAt, findClip, setClipTransformCommand, snapToCanvasEdges } from "@palmier/core";
import type { Transform } from "@palmier/core";
import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TransformOverlayProps {
  store: EditorStore;
  canvasRect: CanvasRect;
}

const SNAP_THRESHOLD = 0.02;
// Numeric constant mirroring --size-overlay-handle (10px); needed for SVG geometry attrs
const HANDLE_SIZE = 10;

type DragMode = "move" | "tl" | "tr" | "bl" | "br";

export function TransformOverlay({ store, canvasRect }: TransformOverlayProps) {
  const selection = useStore(store, (s) => s.selection);
  const playhead = useStore(store, (s) => s.playhead);
  const timeline = useStore(store, (s) => s.timeline);

  const dragRef = useRef<{
    mode: DragMode;
    clipId: string;
    coalesceKey: string;
    startTransform: Transform;
    startPx: { x: number; y: number };
  } | null>(null);

  // All useCallback hooks MUST be called unconditionally (before any early returns)
  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>, mode: DragMode) => {
      e.stopPropagation();
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
      const snap = store.getSnapshot();
      const clipId = [...snap.selection][0];
      if (!clipId) return;
      const snapLoc = findClip(snap.timeline, clipId);
      if (!snapLoc) return;
      const snapClip = snap.timeline.tracks[snapLoc.trackIndex]!.clips[snapLoc.clipIndex]!;
      dragRef.current = {
        mode,
        clipId,
        coalesceKey: `transform-${clipId}`,
        startTransform: snapClip.transform,
        startPx: { x: e.clientX, y: e.clientY },
      };
    },
    [store],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      const d = dragRef.current;
      if (!d) return;
      e.stopPropagation();

      const dx = (e.clientX - d.startPx.x) / canvasRect.width;
      const dy = (e.clientY - d.startPx.y) / canvasRect.height;
      const st = d.startTransform;
      let next: Transform;

      if (d.mode === "move") {
        next = { ...st, centerX: st.centerX + dx, centerY: st.centerY + dy };
        next = snapToCanvasEdges(next, SNAP_THRESHOLD);
      } else {
        let newCX = st.centerX;
        let newCY = st.centerY;
        let newW = st.width;
        let newH = st.height;

        if (d.mode === "tl") {
          newW = Math.max(0.05, st.width - dx * 2);
          newH = Math.max(0.05, st.height - dy * 2);
          newCX = st.centerX + (st.width - newW) / 2;
          newCY = st.centerY + (st.height - newH) / 2;
        } else if (d.mode === "tr") {
          newW = Math.max(0.05, st.width + dx * 2);
          newH = Math.max(0.05, st.height - dy * 2);
          newCX = st.centerX + (newW - st.width) / 2;
          newCY = st.centerY + (st.height - newH) / 2;
        } else if (d.mode === "bl") {
          newW = Math.max(0.05, st.width - dx * 2);
          newH = Math.max(0.05, st.height + dy * 2);
          newCX = st.centerX + (st.width - newW) / 2;
          newCY = st.centerY + (newH - st.height) / 2;
        } else if (d.mode === "br") {
          newW = Math.max(0.05, st.width + dx * 2);
          newH = Math.max(0.05, st.height + dy * 2);
          newCX = st.centerX + (newW - st.width) / 2;
          newCY = st.centerY + (newH - st.height) / 2;
        }
        next = snapToCanvasEdges({ ...st, centerX: newCX, centerY: newCY, width: newW, height: newH }, SNAP_THRESHOLD);
      }

      store.dispatch(setClipTransformCommand(d.clipId, next, d.coalesceKey));
    },
    [store, canvasRect],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    dragRef.current = null;
  }, []);

  const onPointerCancel = useCallback((e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    dragRef.current = null;
  }, []);

  // Early returns AFTER all hooks
  const selectedIds = [...selection];
  if (selectedIds.length !== 1) return null;

  const clipId = selectedIds[0]!;
  const loc = findClip(timeline, clipId);
  if (!loc) return null;

  const clip = timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
  const t = transformAt(clip, playhead);

  const cx = canvasRect.left + t.centerX * canvasRect.width;
  const cy = canvasRect.top + t.centerY * canvasRect.height;
  const hw = (t.width * canvasRect.width) / 2;
  const hh = (t.height * canvasRect.height) / 2;

  const rot = t.rotation;
  const boxX = cx - hw;
  const boxY = cy - hh;
  const boxW = hw * 2;
  const boxH = hh * 2;

  const svgStyle: React.CSSProperties = {
    position: "absolute",
    left: canvasRect.left,
    top: canvasRect.top,
    width: canvasRect.width,
    height: canvasRect.height,
    overflow: "visible",
    pointerEvents: "none",
  };

  const bx = boxX - canvasRect.left;
  const by = boxY - canvasRect.top;
  const groupTransform = `rotate(${rot},${cx - canvasRect.left},${cy - canvasRect.top})`;

  const corners: Array<{ mode: DragMode; x: number; y: number; testid: string }> = [
    { mode: "tl", x: bx, y: by, testid: "transform-handle-tl" },
    { mode: "tr", x: bx + boxW, y: by, testid: "transform-handle-tr" },
    { mode: "bl", x: bx, y: by + boxH, testid: "transform-handle-bl" },
    { mode: "br", x: bx + boxW, y: by + boxH, testid: "transform-handle-br" },
  ];

  return (
    <svg
      style={svgStyle}
      viewBox={`0 0 ${canvasRect.width} ${canvasRect.height}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <g transform={groupTransform}>
        <rect
          x={bx}
          y={by}
          width={boxW}
          height={boxH}
          fill="transparent"
          stroke={theme.overlay.transformBorder}
          strokeWidth={theme.borderWidth.medium}
          style={{ cursor: "move", pointerEvents: "all" }}
          data-testid="transform-handle-move"
          onPointerDown={(e) => onPointerDown(e, "move")}
        />
        {corners.map(({ mode, x, y, testid }) => (
          <rect
            key={mode}
            x={x - HANDLE_SIZE / 2}
            y={y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill={theme.overlay.handleFill}
            stroke={theme.overlay.handleStroke}
            strokeWidth={theme.borderWidth.thin}
            style={{ cursor: "nwse-resize", pointerEvents: "all" }}
            data-testid={testid}
            onPointerDown={(e) => onPointerDown(e, mode)}
          />
        ))}
      </g>
    </svg>
  );
}
