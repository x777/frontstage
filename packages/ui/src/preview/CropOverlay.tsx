import { useCallback, useRef } from "react";
import type { EditorStore } from "@frontstage/core";
import { cropAt, transformAt, findClip, setClipCropCommand } from "@frontstage/core";
import type { Crop } from "@frontstage/core";
import { useStore } from "../store/use-store.js";
import type { CanvasRect } from "./TransformOverlay.js";
import { theme } from "../theme/theme.js";

interface CropOverlayProps {
  store: EditorStore;
  canvasRect: CanvasRect;
}

// Numeric constant mirroring --size-overlay-handle (10px); needed for SVG geometry attrs
const HANDLE_SIZE = 10;

type EdgeHandle = "left" | "top" | "right" | "bottom";

export function CropOverlay({ store, canvasRect }: CropOverlayProps) {
  const selection = useStore(store, (s) => s.selection);
  const playhead = useStore(store, (s) => s.playhead);
  const timeline = useStore(store, (s) => s.timeline);

  const dragRef = useRef<{
    edge: EdgeHandle;
    clipId: string;
    coalesceKey: string;
    startCrop: Crop;
    startPx: { x: number; y: number };
  } | null>(null);

  // All useCallback hooks MUST be called unconditionally (before any early returns)
  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>, edge: EdgeHandle) => {
      e.stopPropagation();
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
      const snap = store.getSnapshot();
      const clipId = [...snap.selection][0];
      if (!clipId) return;
      const snapLoc = findClip(snap.timeline, clipId);
      if (!snapLoc) return;
      const snapClip = snap.timeline.tracks[snapLoc.trackIndex]!.clips[snapLoc.clipIndex]!;
      dragRef.current = {
        edge,
        clipId,
        coalesceKey: `crop-${clipId}`,
        startCrop: snapClip.crop,
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
      const sc = d.startCrop;

      const snap = store.getSnapshot();
      const snapLoc = findClip(snap.timeline, d.clipId);
      if (!snapLoc) return;
      const snapClip = snap.timeline.tracks[snapLoc.trackIndex]!.clips[snapLoc.clipIndex]!;
      const st = snapClip.transform;
      const clipW = st.width;
      const clipH = st.height;

      let next: Crop = { ...sc };
      if (d.edge === "left") {
        next = { ...sc, left: Math.max(0, Math.min(1 - sc.right - 0.05, sc.left + dx / clipW)) };
      } else if (d.edge === "right") {
        next = { ...sc, right: Math.max(0, Math.min(1 - sc.left - 0.05, sc.right - dx / clipW)) };
      } else if (d.edge === "top") {
        next = { ...sc, top: Math.max(0, Math.min(1 - sc.bottom - 0.05, sc.top + dy / clipH)) };
      } else if (d.edge === "bottom") {
        next = { ...sc, bottom: Math.max(0, Math.min(1 - sc.top - 0.05, sc.bottom - dy / clipH)) };
      }

      store.dispatch(setClipCropCommand(d.clipId, next, d.coalesceKey));
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
  const crop = cropAt(clip, playhead);

  const cx = canvasRect.left + t.centerX * canvasRect.width;
  const cy = canvasRect.top + t.centerY * canvasRect.height;
  const hw = (t.width * canvasRect.width) / 2;
  const hh = (t.height * canvasRect.height) / 2;
  const boxL = cx - hw;
  const boxT = cy - hh;
  const boxW = hw * 2;
  const boxH = hh * 2;

  const cropLeft = boxL + crop.left * boxW;
  const cropTop = boxT + crop.top * boxH;
  const cropRight = boxL + boxW - crop.right * boxW;
  const cropBottom = boxT + boxH - crop.bottom * boxH;
  const cropW = cropRight - cropLeft;
  const cropH = cropBottom - cropTop;

  const svgStyle: React.CSSProperties = {
    position: "absolute",
    left: canvasRect.left,
    top: canvasRect.top,
    width: canvasRect.width,
    height: canvasRect.height,
    overflow: "visible",
    pointerEvents: "none",
  };

  const relL = cropLeft - canvasRect.left;
  const relT = cropTop - canvasRect.top;
  const edgeMidX = relL + cropW / 2;
  const edgeMidY = relT + cropH / 2;

  const edgeHandles: Array<{ edge: EdgeHandle; x: number; y: number; testid: string }> = [
    { edge: "left", x: relL, y: edgeMidY, testid: "crop-handle-left" },
    { edge: "right", x: relL + cropW, y: edgeMidY, testid: "crop-handle-right" },
    { edge: "top", x: edgeMidX, y: relT, testid: "crop-handle-top" },
    { edge: "bottom", x: edgeMidX, y: relT + cropH, testid: "crop-handle-bottom" },
  ];

  return (
    <svg
      style={svgStyle}
      viewBox={`0 0 ${canvasRect.width} ${canvasRect.height}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <rect
        x={relL}
        y={relT}
        width={cropW}
        height={cropH}
        fill="none"
        stroke={theme.overlay.cropBorder}
        strokeWidth={theme.borderWidth.medium}
        strokeDasharray="4 3"
        style={{ pointerEvents: "none" }}
      />
      {edgeHandles.map(({ edge, x, y, testid }) => (
        <rect
          key={edge}
          x={x - HANDLE_SIZE / 2}
          y={y - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          fill={theme.overlay.cropHandle}
          stroke={theme.overlay.handleStroke}
          strokeWidth={theme.borderWidth.thin}
          style={{ cursor: edge === "left" || edge === "right" ? "ew-resize" : "ns-resize", pointerEvents: "all" }}
          data-testid={testid}
          onPointerDown={(e) => onPointerDown(e, edge)}
        />
      ))}
    </svg>
  );
}
