import type { EditorState } from "@palmier/core";
import {
  RULER_HEIGHT,
  TRIM_HANDLE_WIDTH,
  clipRect,
  trackHeightAt,
  trackTopY,
  xForFrame,
} from "@palmier/core";
import type { TimelineGeometry, FrameRange } from "@palmier/core";

export interface TimelinePalette {
  bgBase: string;
  bgSurface: string;
  bgRaised: string;
  textPrimary: string;
  textMuted: string;
  borderDivider: string;
  accentTimecode: string;
  accentPrimary: string;
  trackVideo: string;
  trackAudio: string;
  trackImage: string;
  trackText: string;
  trackLottie: string;
  trimHandle: string;
  clipLabel: string;
}

function trackColor(palette: TimelinePalette, mediaType: string): string {
  switch (mediaType) {
    case "audio": return palette.trackAudio;
    case "image": return palette.trackImage;
    case "text": return palette.trackText;
    case "lottie": return palette.trackLottie;
    default: return palette.trackVideo;
  }
}

/** Brighten a hex/rgb/rgba color slightly for clip border. */
function brightenColor(color: string): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const r = Math.min(255, parseInt(hex[1]!.slice(0, 2), 16) + 40);
    const g = Math.min(255, parseInt(hex[1]!.slice(2, 4), 16) + 40);
    const b = Math.min(255, parseInt(hex[1]!.slice(4, 6), 16) + 40);
    return `rgb(${r},${g},${b})`;
  }
  // getComputedStyle resolves CSS vars to rgb()/rgba() — handle both
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    const r = Math.min(255, parseInt(rgb[1]!) + 40);
    const g = Math.min(255, parseInt(rgb[2]!) + 40);
    const b = Math.min(255, parseInt(rgb[3]!) + 40);
    const a = rgb[4] !== undefined ? rgb[4] : "1";
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

function basename(path: string): string {
  return path.split("/").pop()?.split("\\").pop() ?? path;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatTimecode(frame: number, fps: number): string {
  const totalSec = Math.floor(frame / fps);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const f = frame % fps;
  return `${m}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

export type DropIndicator =
  | { kind: "insertion-line"; y: number }
  | { kind: "ghost-clip"; x: number; y: number; width: number; height: number };

export interface TimelineOverlays {
  marquee?: { x: number; y: number; width: number; height: number };
  rangeBand?: { startX: number; endX: number };
  ghostInsert?: {
    gapRangesByTrackIndex: Map<number, FrameRange>;
    shiftDeltasByClipId: Map<string, number>;
  };
}

/**
 * Pure canvas draw — no store, DOM, or var() access.
 * All colors come from `palette` (pre-resolved from getComputedStyle).
 * snapLineX: optional screen-px x for a snap indicator vertical line.
 * dropIndicator: optional media-drag drop indicator.
 * overlays: optional marquee rect + ruler range band.
 */
export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  geom: TimelineGeometry,
  size: { width: number; height: number; dpr: number },
  palette: TimelinePalette,
  snapLineX: number | null = null,
  dropIndicator: DropIndicator | null = null,
  overlays?: TimelineOverlays
): void {
  const { width, height, dpr } = size;

  // Reset transform and scale for DPR
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, width, height);

  // ── Ruler band ──────────────────────────────────────────────────────────────
  ctx.fillStyle = palette.bgRaised;
  ctx.fillRect(0, 0, width, RULER_HEIGHT);

  // Ruler bottom border
  ctx.fillStyle = palette.borderDivider;
  ctx.fillRect(0, RULER_HEIGHT - 1, width, 1);

  const fps = state.timeline.fps;
  // Determine tick interval: aim for ~60px between major ticks
  const pxPerFrame = geom.pixelsPerFrame;
  const pxPerSec = pxPerFrame * fps;

  // Major tick: every 1s if pxPerSec >= 30, else every 5s, else every 30s
  let majorInterval = fps; // 1 second in frames
  if (pxPerSec < 30) majorInterval = fps * 5;
  if (pxPerSec < 6) majorInterval = fps * 30;

  // Minor tick: every frame if pxPerFrame >= 8, else every 5 frames
  let minorInterval = 1;
  if (pxPerFrame < 8) minorInterval = 5;
  if (pxPerFrame < 2) minorInterval = fps; // 1s minor when very zoomed out

  // Total frames visible
  const firstFrame = Math.floor(geom.scrollX / pxPerFrame);
  const visibleFrames = Math.ceil(width / pxPerFrame) + 2;
  const lastFrame = firstFrame + visibleFrames;

  ctx.save();
  ctx.fillStyle = palette.textMuted;
  ctx.font = `9px -apple-system,BlinkMacSystemFont,sans-serif`;
  ctx.textBaseline = "middle";

  for (let f = Math.floor(firstFrame / minorInterval) * minorInterval; f <= lastFrame; f += minorInterval) {
    const x = xForFrame(geom, f);
    if (x < 0 || x > width) continue;

    const isMajor = f % majorInterval === 0;
    if (isMajor) {
      // Major tick
      ctx.fillStyle = palette.textMuted;
      ctx.fillRect(x, RULER_HEIGHT - 10, 1, 10);
      // Timecode label
      ctx.fillStyle = palette.textMuted;
      ctx.fillText(formatTimecode(f, fps), x + 3, RULER_HEIGHT / 2);
    } else {
      // Minor tick
      ctx.fillStyle = palette.borderDivider;
      ctx.fillRect(x, RULER_HEIGHT - 5, 1, 5);
    }
  }
  ctx.restore();

  // ── Track backgrounds ────────────────────────────────────────────────────────
  const tracks = state.timeline.tracks;
  for (let ti = 0; ti < tracks.length; ti++) {
    const ty = trackTopY(geom, ti);
    const th = trackHeightAt(geom, ti);
    ctx.fillStyle = ti % 2 === 0 ? palette.bgBase : palette.bgSurface;
    ctx.fillRect(0, ty, width, th);

    // Track bottom border
    ctx.fillStyle = palette.bgRaised;
    ctx.fillRect(0, ty + th - 1, width, 1);
  }

  // Fill any area below tracks
  const totalTracksHeight = geom.cumulativeY[geom.cumulativeY.length - 1] ?? RULER_HEIGHT;
  const lastTrackH = geom.trackHeights[geom.trackHeights.length - 1] ?? 0;
  const tracksEnd = totalTracksHeight + lastTrackH;
  if (tracksEnd < height) {
    ctx.fillStyle = palette.bgBase;
    ctx.fillRect(0, tracksEnd, width, height - tracksEnd);
  }

  // ── Clips ────────────────────────────────────────────────────────────────────
  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti]!;
    for (const clip of track.clips) {
      const rect = clipRect(geom, clip, ti);
      // Skip if off-screen
      if (rect.x + rect.width < 0 || rect.x > width) continue;

      const color = trackColor(palette, clip.mediaType);
      const radius = 3;

      // Fill clip
      roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
      ctx.fillStyle = color;
      ctx.fill();

      // 1px brighter border
      roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
      ctx.strokeStyle = brightenColor(color);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Selection outline (2px accent)
      if (state.selection.has(clip.id)) {
        roundRect(ctx, rect.x - 1, rect.y - 1, rect.width + 2, rect.height + 2, radius + 1);
        ctx.strokeStyle = palette.accentPrimary;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Trim handles (subtle insets at edges)
      const handleW = Math.min(TRIM_HANDLE_WIDTH, rect.width / 4);
      const handleInset = 3;
      if (rect.width > handleW * 3) {
        // Left handle
        ctx.save();
        ctx.fillStyle = palette.trimHandle;
        ctx.fillRect(rect.x, rect.y + handleInset, handleW, rect.height - handleInset * 2);
        ctx.restore();

        // Right handle
        ctx.save();
        ctx.fillStyle = palette.trimHandle;
        ctx.fillRect(rect.x + rect.width - handleW, rect.y + handleInset, handleW, rect.height - handleInset * 2);
        ctx.restore();
      }

      // Clip label (clipped to rect)
      if (rect.width > 20) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x + 2, rect.y, rect.width - 4, rect.height);
        ctx.clip();
        ctx.fillStyle = palette.clipLabel;
        ctx.font = `10px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = "middle";
        const label = basename(clip.mediaRef);
        ctx.fillText(label, rect.x + TRIM_HANDLE_WIDTH + 2, rect.y + rect.height / 2);
        ctx.restore();
      }
    }
  }

  // ── Playhead ──────────────────────────────────────────────────────────────────
  const phX = Math.round(xForFrame(geom, state.playhead));
  if (phX >= 0 && phX <= width) {
    ctx.fillStyle = palette.accentTimecode;
    ctx.fillRect(phX, 0, 2, height);
  }

  // ── Snap indicator ────────────────────────────────────────────────────────────
  if (snapLineX !== null) {
    const sx = Math.round(snapLineX);
    if (sx >= 0 && sx <= width) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = palette.accentPrimary;
      ctx.fillRect(sx, RULER_HEIGHT, 1, height - RULER_HEIGHT);
      ctx.restore();
    }
  }

  // ── Drop indicator ────────────────────────────────────────────────────────────
  if (dropIndicator !== null) {
    ctx.save();
    if (dropIndicator.kind === "insertion-line") {
      const ly = Math.round(dropIndicator.y);
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = palette.accentPrimary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(width, ly);
      ctx.stroke();
    } else {
      // ghost-clip rect
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = palette.accentPrimary;
      roundRect(ctx, dropIndicator.x, dropIndicator.y, dropIndicator.width, dropIndicator.height, 3);
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = palette.accentPrimary;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      roundRect(ctx, dropIndicator.x, dropIndicator.y, dropIndicator.width, dropIndicator.height, 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Range band (ruler in/out selection) ──────────────────────────────────────
  if (overlays?.rangeBand) {
    const { startX, endX } = overlays.rangeBand;
    const bandLeft = Math.min(startX, endX);
    const bandRight = Math.max(startX, endX);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = palette.accentTimecode;
    ctx.fillRect(bandLeft, RULER_HEIGHT, bandRight - bandLeft, height - RULER_HEIGHT);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = palette.accentTimecode;
    ctx.fillRect(bandLeft, RULER_HEIGHT, 1, height - RULER_HEIGHT);
    ctx.fillRect(bandRight, RULER_HEIGHT, 1, height - RULER_HEIGHT);
    ctx.restore();
  }

  // ── Ghost-insert preview (ripple mode drag) ───────────────────────────────────
  if (overlays?.ghostInsert) {
    const { gapRangesByTrackIndex, shiftDeltasByClipId } = overlays.ghostInsert;
    ctx.save();

    // Draw gap regions on affected tracks
    for (const [ti, range] of gapRangesByTrackIndex) {
      if (ti < 0 || ti >= tracks.length) continue;
      const ty = trackTopY(geom, ti);
      const th = trackHeightAt(geom, ti);
      const x1 = xForFrame(geom, range.start);
      const x2 = xForFrame(geom, range.end);
      const gapW = x2 - x1;
      if (gapW <= 0) continue;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = palette.accentPrimary;
      ctx.fillRect(x1, ty, gapW, th);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = palette.accentPrimary;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1 + 0.5, ty + 0.5, gapW - 1, th - 1);
    }

    // Draw shifted clips as faint outlines at their new positions
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = palette.accentPrimary;
    for (let ti = 0; ti < tracks.length; ti++) {
      for (const clip of tracks[ti]!.clips) {
        const delta = shiftDeltasByClipId.get(clip.id);
        if (!delta) continue;
        const orig = clipRect(geom, clip, ti);
        ctx.strokeRect(orig.x + delta * geom.pixelsPerFrame + 0.5, orig.y + 0.5, orig.width - 1, orig.height - 1);
      }
    }
    ctx.restore();
  }

  // ── Marquee selection rect ───────────────────────────────────────────────────
  if (overlays?.marquee) {
    const { x, y, width, height: mh } = overlays.marquee;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = palette.accentPrimary;
    ctx.fillRect(x, y, width, mh);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = palette.accentPrimary;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, width, mh);
    ctx.restore();
  }
}
