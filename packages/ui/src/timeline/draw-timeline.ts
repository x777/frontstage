import type { EditorState, Clip } from "@frontstage/core";
import {
  RULER_HEIGHT,
  TRIM_HANDLE_WIDTH,
  clipRect,
  parseGenerationStatus,
  smoothstep,
  trackHeightAt,
  trackTopY,
  xForFrame,
} from "@frontstage/core";
import type { TimelineGeometry, FrameRange } from "@frontstage/core";
import { generatingLabel } from "../media/GeneratingOverlay.js";
import { rulerTicks } from "./ruler-ticks.js";

export interface TimelinePalette {
  bgBase: string;
  bgSurface: string;
  bgRaised: string;
  textPrimary: string;
  textMuted: string;
  textTertiary: string;
  borderPrimary: string;
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
  generatingScrim: string;
  failedScrim: string;
  /** Resolved `--font-xs` (e.g. "10px") — the ruler label size, Swift's AppTheme.FontSize.xs. Also the clip label's size (ClipRenderer.drawLabelBar uses the same AppTheme.FontSize.xs). */
  rulerLabelFontPx: string;
  /** NSColor.systemRed (dark appearance) — PlayheadOverlay.Playhead.color. */
  playhead: string;
  /** NSColor.systemYellow (dark appearance) — SnapIndicatorOverlay's dashed line. */
  snapIndicator: string;
  /** NSColor.systemOrange @ 0.8 (dark appearance) — TimelineView.swift:250-259 razor preview line. */
  razorLine: string;
  /** Resolved `--size-clip-detail-min` (px, parsed to number) — AppTheme.ComponentSize.timelineClipDetailMinWidth (32). */
  clipDetailMinWidth: number;
  /** Resolved `--size-clip-label-min` (px, parsed to number) — AppTheme.ComponentSize.timelineClipLabelMinWidth (56). */
  clipLabelMinWidth: number;
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

// ── ClipRenderer.swift ports (clip chrome geometry/alpha literals) ──────────────
// Swift hardcodes these directly (not via AppTheme), so they're plain literals here too.
const CLIP_CORNER_RADIUS = 3; // Trim.clipCornerRadius
const CLIP_LABEL_BAR_HEIGHT = 16; // ClipRenderer.labelBarHeight
const CLIP_STRIP_WIDTH = 3; // ClipRenderer's own stripWidth local — same value as the track header's --size-track-strip
const CLIP_LABEL_INSET = 6; // ClipRenderer.drawLabelBar inset
const CLIP_FADE_KNEE_TOP_INSET = 4; // ClipRenderer.fadeKneeTopInset
const CLIP_FADE_HANDLE_EDGE_INSET = 6; // ClipRenderer.volumeFadeHandleEdgeInset
const CLIP_FILL_ALPHA = 0.3; // baseColor.withAlphaComponent(0.3), unselected
const CLIP_FILL_ALPHA_SELECTED = 0.45;
const CLIP_BORDER_SELECTED = "rgba(255,255,255,0.9)";
const CLIP_BORDER_SELECTED_WIDTH = 1.5;
const CLIP_BORDER_WIDTH = 0.5;
const CLIP_FADE_ALPHA_SELECTED = 0.95;
const CLIP_FADE_ALPHA_UNSELECTED = 0.75;
const CLIP_FADE_WEDGE_FILL_ALPHA = 0.6; // black wash over the fade region
const CLIP_FADE_LINE_WIDTH = 1.5;

// TimelineView.swift:459-510 (drawTimelineRangeSelection*) alpha/width literals.
const RANGE_TRACK_FILL_OPACITY = 0.06; // AppTheme.Opacity.hint
const RANGE_RULER_FILL_OPACITY = 0.1; // AppTheme.Opacity.soft
const RANGE_EDGE_OPACITY = 0.8; // AppTheme.Opacity.prominent
const RANGE_EDGE_WIDTH = 1.5; // AppTheme.BorderWidth.medium

const PLAYHEAD_TRIANGLE_SIZE = 8; // Playhead.triangleSize

/** Replace (not multiply) a resolved color's alpha — mirrors NSColor.withAlphaComponent. */
function withAlpha(color: string, alpha: number): string {
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const r = parseInt(hex[1]!.slice(0, 2), 16);
    const g = parseInt(hex[1]!.slice(2, 4), 16);
    const b = parseInt(hex[1]!.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

function basename(path: string): string {
  return path.split("/").pop()?.split("\\").pop() ?? path;
}

/** Port of EditorViewModel+MediaLibrary.swift's clipDisplayLabel (:346-359). */
function clipDisplayLabel(clip: Clip, nameByRef: Map<string, string> | undefined): string {
  if (clip.mediaType === "text") {
    const content = clip.textContent ?? "";
    if (content === "") return "Text";
    return content.replace(/\n/g, " ").replace(/\r/g, " ");
  }
  return nameByRef?.get(clip.mediaRef) ?? basename(clip.mediaRef);
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

/** Port of ClipRenderer.fadeCurvePoints: linear is just the endpoint, smooth samples 12 steps. */
function fadeCurvePoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  interpolation: "linear" | "smooth"
): Array<{ x: number; y: number }> {
  if (interpolation !== "smooth") return [{ x: endX, y: endY }];
  const steps = 12;
  const points: Array<{ x: number; y: number }> = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    points.push({ x: startX + (endX - startX) * t, y: startY + (endY - startY) * smoothstep(t) });
  }
  return points;
}

/** Port of ClipRenderer.drawFadeWedge: a dark wash over the fade region + a stroked fade curve. */
function drawFadeWedge(
  ctx: CanvasRenderingContext2D,
  silentX: number,
  silentY: number,
  kneeX: number,
  kneeY: number,
  fillTopY: number,
  curve: Array<{ x: number; y: number }>,
  strokeColor: string
) {
  ctx.beginPath();
  ctx.moveTo(silentX, silentY);
  ctx.lineTo(silentX, fillTopY);
  ctx.lineTo(kneeX, fillTopY);
  if (fillTopY !== kneeY) ctx.lineTo(kneeX, kneeY);
  for (let i = curve.length - 2; i >= 0; i--) ctx.lineTo(curve[i]!.x, curve[i]!.y);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${CLIP_FADE_WEDGE_FILL_ALPHA})`;
  ctx.fill();

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = CLIP_FADE_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(silentX, silentY);
  for (const p of curve) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

/**
 * Port of ClipRenderer.drawOpacityFades — the fade-in/out wedges for non-audio clips.
 * Swift's audio-only volume rubber band (keyframed dB automation) is a separate, unported feature.
 */
function drawClipFades(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  rect: { x: number; y: number; width: number; height: number },
  isSelected: boolean
): void {
  if (clip.mediaType === "audio") return;
  if (clip.durationFrames <= 0) return;
  if (clip.fadeInFrames <= 0 && clip.fadeOutFrames <= 0) return;
  const pxPerFrame = rect.width / clip.durationFrames;
  if (pxPerFrame <= 0) return;

  const bodyY = rect.y + CLIP_LABEL_BAR_HEIGHT;
  const bodyHeight = Math.max(0, rect.height - CLIP_LABEL_BAR_HEIGHT - 1);
  const bodyBottom = bodyY + bodyHeight;
  const kneeY = bodyY + CLIP_FADE_KNEE_TOP_INSET;

  const alpha = isSelected ? CLIP_FADE_ALPHA_SELECTED : CLIP_FADE_ALPHA_UNSELECTED;
  const strokeColor = `rgba(255,255,255,${alpha * 0.7})`;

  const kneeXFor = (kfOffset: number, isLeft: boolean): number => {
    const actual = rect.x + kfOffset * pxPerFrame;
    return isLeft
      ? Math.max(rect.x + CLIP_FADE_HANDLE_EDGE_INSET, actual)
      : Math.min(rect.x + rect.width - CLIP_FADE_HANDLE_EDGE_INSET, actual);
  };

  if (clip.fadeInFrames > 0) {
    const leftOffset = Math.min(clip.fadeInFrames, clip.durationFrames);
    const kneeX = kneeXFor(leftOffset, true);
    const curve = fadeCurvePoints(rect.x, bodyBottom, kneeX, kneeY, clip.fadeInInterpolation);
    drawFadeWedge(ctx, rect.x, bodyBottom, kneeX, kneeY, bodyY, curve, strokeColor);
  }
  if (clip.fadeOutFrames > 0) {
    const rightOffset = Math.max(0, clip.durationFrames - clip.fadeOutFrames);
    const kneeX = kneeXFor(rightOffset, false);
    const curve = fadeCurvePoints(rect.x + rect.width, bodyBottom, kneeX, kneeY, clip.fadeOutInterpolation);
    drawFadeWedge(ctx, rect.x + rect.width, bodyBottom, kneeX, kneeY, bodyY, curve, strokeColor);
  }
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
 * statusByRef: optional mediaRef → serialized GenerationStatus map for the generating/failed clip scrim.
 * nameByRef: optional mediaRef → media entry display name, for the clip label (falls back to the
 * mediaRef's basename when absent, so existing callers/tests without a library keep their old label).
 */
export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  geom: TimelineGeometry,
  size: { width: number; height: number; dpr: number },
  palette: TimelinePalette,
  snapLineX: number | null = null,
  dropIndicator: DropIndicator | null = null,
  overlays?: TimelineOverlays,
  statusByRef?: Map<string, string>,
  nameByRef?: Map<string, string>,
  razorLineX: number | null = null
): void {
  const { width, height, dpr } = size;

  // Reset transform and scale for DPR
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, width, height);

  // ── Ruler band ──────────────────────────────────────────────────────────────
  // Port of TimelineRuler.swift.draw: background, bottom separator, adaptive ticks + labels.
  ctx.fillStyle = palette.bgSurface;
  ctx.fillRect(0, 0, width, RULER_HEIGHT);

  ctx.fillStyle = palette.borderPrimary;
  ctx.fillRect(0, RULER_HEIGHT - 1, width, 1);

  const fps = state.timeline.fps;
  // xForFrame(g,f) = g.headerWidth + f*pixelsPerFrame - g.scrollX; feeding scrollX-headerWidth as
  // rulerTicks' scrollOffsetX makes its returned x already equal xForFrame's screen-space x.
  const ticks = rulerTicks({
    pixelsPerFrame: geom.pixelsPerFrame,
    fps,
    scrollOffsetX: geom.scrollX - geom.headerWidth,
    width,
    formatTimecode,
  });

  // Minor ticks first so major ticks draw on top
  if (ticks.minors.length > 0) {
    ctx.save();
    ctx.strokeStyle = withAlpha(palette.textMuted, 0.4);
    ctx.lineWidth = 0.5;
    for (const minor of ticks.minors) {
      ctx.beginPath();
      ctx.moveTo(minor.x, RULER_HEIGHT - minor.height);
      ctx.lineTo(minor.x, RULER_HEIGHT);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (ticks.majors.length > 0) {
    ctx.save();
    ctx.strokeStyle = palette.textMuted;
    ctx.lineWidth = 1;
    ctx.fillStyle = palette.textTertiary;
    ctx.font = `${palette.rulerLabelFontPx} ui-monospace, monospace`;
    ctx.textBaseline = "top";
    for (const major of ticks.majors) {
      ctx.beginPath();
      ctx.moveTo(major.x, RULER_HEIGHT - 8);
      ctx.lineTo(major.x, RULER_HEIGHT);
      ctx.stroke();
      ctx.fillText(major.label, major.x + 3, 2);
    }
    ctx.restore();
  }

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
      const isSelected = state.selection.has(clip.id);
      const radius = CLIP_CORNER_RADIUS;

      // Body fill — track color, alpha replaced (not multiplied) per selection state.
      roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
      ctx.fillStyle = withAlpha(color, isSelected ? CLIP_FILL_ALPHA_SELECTED : CLIP_FILL_ALPHA);
      ctx.fill();

      // Fade-in/out wedges (video/image/text/lottie only — Swift's audio volume rubber band is unported).
      drawClipFades(ctx, clip, rect, isSelected);

      // Color-coded left edge strip, full opacity, clipped to the same corner radius.
      roundRect(ctx, rect.x, rect.y, CLIP_STRIP_WIDTH, rect.height, radius);
      ctx.fillStyle = color;
      ctx.fill();

      // Border
      roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
      if (isSelected) {
        ctx.strokeStyle = CLIP_BORDER_SELECTED;
        ctx.lineWidth = CLIP_BORDER_SELECTED_WIDTH;
      } else {
        ctx.strokeStyle = palette.borderPrimary;
        ctx.lineWidth = CLIP_BORDER_WIDTH;
      }
      ctx.stroke();

      const showDetailChrome = isSelected || rect.width >= palette.clipDetailMinWidth;
      const showLabel = isSelected || rect.width >= palette.clipLabelMinWidth;

      // Trim handles — full clip height, no inset, gated by the detail-min token.
      if (showDetailChrome) {
        ctx.fillStyle = palette.trimHandle;
        ctx.fillRect(rect.x, rect.y, TRIM_HANDLE_WIDTH, rect.height);
        ctx.fillRect(rect.x + rect.width - TRIM_HANDLE_WIDTH, rect.y, TRIM_HANDLE_WIDTH, rect.height);
      }

      // Clip label — name + own-duration timecode, in the label bar strip at the clip's top.
      if (showLabel && rect.width > 20) {
        const contentX = rect.x + CLIP_STRIP_WIDTH + 1;
        const contentWidth = rect.width - CLIP_STRIP_WIDTH - 1 - TRIM_HANDLE_WIDTH;
        const labelY = rect.y;
        const name = clipDisplayLabel(clip, nameByRef);
        const text = `${name}  ${formatTimecode(clip.durationFrames, fps)}`;

        ctx.save();
        ctx.beginPath();
        ctx.rect(contentX + CLIP_LABEL_INSET, labelY, Math.max(0, contentWidth - CLIP_LABEL_INSET * 2), CLIP_LABEL_BAR_HEIGHT);
        ctx.clip();
        ctx.fillStyle = palette.clipLabel;
        ctx.font = `500 ${palette.rulerLabelFontPx} -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = "middle";
        const textX = contentX + CLIP_LABEL_INSET;
        const textY = labelY + CLIP_LABEL_BAR_HEIGHT / 2;
        ctx.fillText(text, textX, textY);
        if (clip.linkGroupId !== undefined) {
          const nameWidth = ctx.measureText(name).width;
          const fontPx = parseFloat(palette.rulerLabelFontPx) || 10;
          ctx.strokeStyle = palette.clipLabel;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(textX, textY + fontPx / 2 + 1);
          ctx.lineTo(textX + nameWidth, textY + fontPx / 2 + 1);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Generation status scrim — STATIC (Swift animates a 45s progress bar; deliberate canvas deviation, see plan).
      const rawStatus = statusByRef?.get(clip.mediaRef);
      if (rawStatus !== undefined) {
        const status = parseGenerationStatus(rawStatus);
        if (status.kind !== "none") {
          const isFailed = status.kind === "failed";
          ctx.save();
          roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
          ctx.fillStyle = isFailed ? palette.failedScrim : palette.generatingScrim;
          ctx.fill();
          if (rect.width > 20) {
            ctx.fillStyle = palette.clipLabel;
            ctx.font = `10px -apple-system,BlinkMacSystemFont,sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(isFailed ? "Failed" : generatingLabel(status), rect.x + rect.width / 2, rect.y + rect.height / 2);
          }
          ctx.restore();
        }
      }
    }
  }

  // ── Playhead ──────────────────────────────────────────────────────────────────
  // Port of PlayheadOverlay: a 1px line from the ruler bottom down, plus a downward-pointing
  // triangle head whose tip sits at the ruler/track boundary (both filled+stroked in Playhead.color).
  const phX = Math.round(xForFrame(geom, state.playhead));
  const phHalf = PLAYHEAD_TRIANGLE_SIZE / 2;
  if (phX >= -phHalf && phX <= width + phHalf) {
    ctx.save();
    ctx.strokeStyle = palette.playhead;
    ctx.fillStyle = palette.playhead;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(phX, RULER_HEIGHT);
    ctx.lineTo(phX, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(phX, RULER_HEIGHT);
    ctx.lineTo(phX - phHalf, RULER_HEIGHT - PLAYHEAD_TRIANGLE_SIZE);
    ctx.lineTo(phX + phHalf, RULER_HEIGHT - PLAYHEAD_TRIANGLE_SIZE);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Snap indicator ────────────────────────────────────────────────────────────
  // Port of SnapIndicatorOverlay: dashed systemYellow line, full opacity, ruler bottom to view bottom.
  if (snapLineX !== null) {
    const sx = Math.round(snapLineX);
    if (sx >= 0 && sx <= width) {
      ctx.save();
      ctx.strokeStyle = palette.snapIndicator;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, RULER_HEIGHT);
      ctx.lineTo(sx, height);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Razor preview line ─────────────────────────────────────────────────────────
  // Port of TimelineView.swift:250-259 — the razor preview: dashed systemOrange line.
  if (razorLineX !== null) {
    const rx = Math.round(razorLineX);
    ctx.strokeStyle = palette.razorLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(rx, RULER_HEIGHT);
    ctx.lineTo(rx, height);
    ctx.stroke();
    ctx.setLineDash([]);
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
  // Port of TimelineView's 3-part drawTimelineRangeSelection*: track fill (text-primary@hint),
  // ruler fill (text-primary@soft), and edges confined to the ruler band (timecode-accent@prominent).
  if (overlays?.rangeBand) {
    const { startX, endX } = overlays.rangeBand;
    const bandLeft = Math.min(startX, endX);
    const bandRight = Math.max(startX, endX);

    ctx.fillStyle = withAlpha(palette.textPrimary, RANGE_TRACK_FILL_OPACITY);
    ctx.fillRect(bandLeft, RULER_HEIGHT, bandRight - bandLeft, Math.max(0, height - RULER_HEIGHT));

    ctx.fillStyle = withAlpha(palette.textPrimary, RANGE_RULER_FILL_OPACITY);
    ctx.fillRect(bandLeft, 0, bandRight - bandLeft, RULER_HEIGHT);

    ctx.save();
    ctx.strokeStyle = withAlpha(palette.accentTimecode, RANGE_EDGE_OPACITY);
    ctx.lineWidth = RANGE_EDGE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(bandLeft, 0);
    ctx.lineTo(bandLeft, RULER_HEIGHT);
    ctx.moveTo(bandRight, 0);
    ctx.lineTo(bandRight, RULER_HEIGHT);
    ctx.stroke();
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
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, mh - 1);
    ctx.restore();
  }
}
