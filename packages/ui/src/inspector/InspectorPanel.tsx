import type { EditorStore, MediaManifestEntry } from "@palmier/core";
import {
  findClip,
  transformAt,
  cropAt,
  opacityAt,
  setClipTransformCommand,
  setClipCropCommand,
  setClipPropertyCommand,
  setKeyframeCommand,
  setClipTextStyleCommand,
  defaultTextStyle,
  rgbaFromHex,
} from "@palmier/core";
import type { Clip, Transform, Crop, TextStyle } from "@palmier/core";
import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";
import { NumberField, SliderField, ToggleField, TextField, Section } from "./fields.js";
import { KeyframeLanes } from "./KeyframeLanes.js";
import { BasicCorrectionSection } from "./adjust/BasicCorrectionSection.js";
import { CurvesSection } from "./adjust/CurvesSection.js";
import { ColorWheelsSection } from "./adjust/ColorWheelsSection.js";

interface MediaLibraryLike {
  entry(id: string): MediaManifestEntry | undefined;
}

export interface InspectorPanelProps {
  store: EditorStore;
  library?: MediaLibraryLike;
}

const VISUAL_TYPES = new Set(["video", "image", "text", "lottie"]);
const AUDIO_TYPES = new Set(["audio", "video"]);

function rgbaToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function isNonTextVisual(c: Clip): boolean {
  return VISUAL_TYPES.has(c.mediaType) && c.mediaType !== "text";
}

export function InspectorPanel({ store, library }: InspectorPanelProps) {
  const selection = useStore(store, (s) => s.selection);
  const playhead = useStore(store, (s) => s.playhead);
  const timeline = useStore(store, (s) => s.timeline);

  const emptyState = (
    <div
      data-testid="inspector-empty"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.muted,
        fontSize: theme.fontSize.sm,
      }}
    >
      No clip selected
    </div>
  );

  if (selection.size === 0) return emptyState;

  // Multi-selection: show Basic Correction if all selected clips are non-text visual
  if (selection.size > 1) {
    const selIds = [...selection];
    const selClips = selIds.flatMap((id) => {
      const loc = findClip(timeline, id);
      if (!loc) return [];
      const track = timeline.tracks[loc.trackIndex];
      if (!track) return [];
      const clip = track.clips[loc.clipIndex];
      if (!clip) return [];
      return [clip];
    });
    if (selClips.length > 0 && selClips.every(isNonTextVisual)) {
      return (
        <div
          data-testid="inspector-panel"
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflowY: "auto",
            background: theme.bg.surface,
          }}
        >
          <BasicCorrectionSection store={store} clipIds={selIds} />
          <CurvesSection store={store} clipIds={selIds} />
          <ColorWheelsSection store={store} clipIds={selIds} />
        </div>
      );
    }
    return emptyState;
  }

  const clipId = [...selection][0]!;
  const loc = findClip(timeline, clipId);
  if (!loc) return emptyState;

  const clip = timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
  const entry = library?.entry(clip.mediaRef);
  const isVisual = VISUAL_TYPES.has(clip.mediaType);
  const hasAudio = AUDIO_TYPES.has(clip.mediaType);
  const isText = clip.mediaType === "text";

  const t = isVisual ? transformAt(clip, playhead) : clip.transform;
  const c = isVisual ? cropAt(clip, playhead) : clip.crop;
  const opacity = isVisual ? opacityAt(clip, playhead) : clip.opacity;

  const kfOffset = playhead - clip.startFrame;
  const kfActive = (track: { keyframes: unknown[] } | undefined) => !!track && track.keyframes.length > 0;

  const dispatchTransform = (next: Transform) => {
    const key = `transform-${clip.id}`;
    store.dispatch(setClipTransformCommand(clip.id, next, key));
    // When a transform track is keyframed, transformAt() samples the keyframe and ignores the
    // base — so also write the keyframe at the playhead, or the edit appears to do nothing.
    if (kfActive(clip.scaleTrack)) store.dispatch(setKeyframeCommand(clip.id, "scaleTrack", kfOffset, { a: next.width, b: next.height }, "linear", key));
    if (kfActive(clip.rotationTrack)) store.dispatch(setKeyframeCommand(clip.id, "rotationTrack", kfOffset, next.rotation, "linear", key));
    if (kfActive(clip.positionTrack)) store.dispatch(setKeyframeCommand(clip.id, "positionTrack", kfOffset, { a: next.centerX - next.width / 2, b: next.centerY - next.height / 2 }, "linear", key));
  };

  const dispatchCrop = (next: Crop) => {
    const key = `crop-${clip.id}`;
    if (kfActive(clip.cropTrack)) store.dispatch(setKeyframeCommand(clip.id, "cropTrack", kfOffset, next, "linear", key));
    else store.dispatch(setClipCropCommand(clip.id, next, key));
  };

  const style = clip.textStyle ?? defaultTextStyle();
  const hexColor = rgbaToHex(style.color.r, style.color.g, style.color.b);

  return (
    <div
      data-testid="inspector-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        background: theme.bg.surface,
      }}
    >
      {/* Info */}
      <Section title="Info">
        <InfoRow label="Name" value={entry?.name ?? clip.mediaRef} />
        <InfoRow label="Type" value={clip.mediaType} />
        {entry?.sourceWidth && entry?.sourceHeight && (
          <InfoRow label="Source" value={`${entry.sourceWidth}×${entry.sourceHeight}`} />
        )}
        {entry?.sourceFPS && (
          <InfoRow label="FPS" value={String(entry.sourceFPS)} />
        )}
      </Section>

      {/* Transform */}
      {isVisual && (
        <Section title="Transform">
          <NumberField
            label="X"
            value={t.centerX}
            step={0.001}
            onChange={(v) => dispatchTransform({ ...t, centerX: v })}
          />
          <NumberField
            label="Y"
            value={t.centerY}
            step={0.001}
            onChange={(v) => dispatchTransform({ ...t, centerY: v })}
          />
          <NumberField
            label="Width"
            value={t.width}
            step={0.001}
            min={0.001}
            onChange={(v) => dispatchTransform({ ...t, width: v })}
          />
          <NumberField
            label="Height"
            value={t.height}
            step={0.001}
            min={0.001}
            onChange={(v) => dispatchTransform({ ...t, height: v })}
          />
          <NumberField
            label="Rotation"
            value={t.rotation}
            step={1}
            onChange={(v) => dispatchTransform({ ...t, rotation: v })}
          />
          <ToggleField
            label="Flip H"
            value={t.flipHorizontal}
            onChange={(v) => dispatchTransform({ ...t, flipHorizontal: v })}
          />
          <ToggleField
            label="Flip V"
            value={t.flipVertical}
            onChange={(v) => dispatchTransform({ ...t, flipVertical: v })}
          />
        </Section>
      )}

      {/* Crop */}
      {isVisual && (
        <Section title="Crop">
          <NumberField
            label="Left"
            value={c.left}
            step={0.001}
            min={0}
            max={1}
            onChange={(v) => dispatchCrop({ ...c, left: v })}
          />
          <NumberField
            label="Top"
            value={c.top}
            step={0.001}
            min={0}
            max={1}
            onChange={(v) => dispatchCrop({ ...c, top: v })}
          />
          <NumberField
            label="Right"
            value={c.right}
            step={0.001}
            min={0}
            max={1}
            onChange={(v) => dispatchCrop({ ...c, right: v })}
          />
          <NumberField
            label="Bottom"
            value={c.bottom}
            step={0.001}
            min={0}
            max={1}
            onChange={(v) => dispatchCrop({ ...c, bottom: v })}
          />
        </Section>
      )}

      {/* Opacity */}
      {isVisual && (
        <Section title="Opacity">
          <SliderField
            label="Opacity"
            value={opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) =>
              kfActive(clip.opacityTrack)
                ? store.dispatch(setKeyframeCommand(clip.id, "opacityTrack", kfOffset, v, "linear", `opacity-${clip.id}`))
                : store.dispatch(setClipPropertyCommand(clip.id, "opacity", v, `opacity-${clip.id}`))
            }
          />
        </Section>
      )}

      {/* Volume */}
      {hasAudio && (
        <Section title="Volume">
          <SliderField
            label="Volume"
            value={clip.volume}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) =>
              store.dispatch(setClipPropertyCommand(clip.id, "volume", v, `volume-${clip.id}`))
            }
          />
          <NumberField
            label="Fade In"
            value={clip.fadeInFrames}
            step={1}
            min={0}
            onChange={(v) =>
              store.dispatch(setClipPropertyCommand(clip.id, "fadeInFrames", Math.round(v), `fadein-${clip.id}`))
            }
          />
          <NumberField
            label="Fade Out"
            value={clip.fadeOutFrames}
            step={1}
            min={0}
            onChange={(v) =>
              store.dispatch(setClipPropertyCommand(clip.id, "fadeOutFrames", Math.round(v), `fadeout-${clip.id}`))
            }
          />
        </Section>
      )}

      {/* Speed */}
      <Section title="Speed">
        <NumberField
          label="Speed"
          value={clip.speed}
          step={0.1}
          min={0.1}
          onChange={(v) =>
            store.dispatch(setClipPropertyCommand(clip.id, "speed", v, `speed-${clip.id}`))
          }
        />
      </Section>

      {/* Keyframe Lanes */}
      <KeyframeLanes clip={clip} playhead={playhead} store={store} />

      {/* Text */}
      {isText && (
        <Section title="Text">
          <TextField
            label="Content"
            value={clip.textContent ?? ""}
            onChange={(v) =>
              store.dispatch(setClipPropertyCommand(clip.id, "textContent", v, `text-${clip.id}`))
            }
          />
          <TextField
            label="Font"
            value={style.fontName}
            onChange={(v) => {
              const next: TextStyle = { ...style, fontName: v };
              store.dispatch(setClipTextStyleCommand(clip.id, next, `textstyle-${clip.id}`));
            }}
          />
          <NumberField
            label="Font Size"
            value={style.fontSize}
            step={1}
            min={1}
            onChange={(v) => {
              const next: TextStyle = { ...style, fontSize: v };
              store.dispatch(setClipTextStyleCommand(clip.id, next, `textstyle-${clip.id}`));
            }}
          />
          <NumberField
            label="Scale"
            value={style.fontScale}
            step={0.1}
            min={0.1}
            onChange={(v) => {
              const next: TextStyle = { ...style, fontScale: v };
              store.dispatch(setClipTextStyleCommand(clip.id, next, `textstyle-${clip.id}`));
            }}
          />
          <TextField
            label="Color"
            value={hexColor}
            onChange={(v) => {
              const rgba = rgbaFromHex(v);
              if (!rgba) return;
              const next: TextStyle = { ...style, color: rgba };
              store.dispatch(setClipTextStyleCommand(clip.id, next, `textstyle-${clip.id}`));
            }}
          />
          <AlignmentField
            value={style.alignment}
            onChange={(v) => {
              const next: TextStyle = { ...style, alignment: v };
              store.dispatch(setClipTextStyleCommand(clip.id, next, `textstyle-${clip.id}`));
            }}
          />
        </Section>
      )}

      {/* Basic Correction */}
      {isVisual && !isText && (
        <BasicCorrectionSection store={store} clipIds={[clipId]} />
      )}

      {/* Curves */}
      {isVisual && !isText && (
        <CurvesSection store={store} clipIds={[clipId]} />
      )}

      {/* Color Wheels */}
      {isVisual && !isText && (
        <ColorWheelsSection store={store} clipIds={[clipId]} />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xxs} 0`,
      }}
    >
      <span
        style={{
          fontSize: theme.fontSize.xs,
          color: theme.text.secondary,
          minWidth: theme.size.inspectorLabel,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: theme.fontSize.xs,
          color: theme.text.primary,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

type TextAlignment = "left" | "center" | "right";

function AlignmentField({ value, onChange }: { value: TextAlignment; onChange: (v: TextAlignment) => void }) {
  const options: TextAlignment[] = ["left", "center", "right"];
  return (
    <div
      data-testid="inspector-alignment"
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xxs} 0`,
      }}
    >
      <span
        style={{
          fontSize: theme.fontSize.xs,
          color: theme.text.secondary,
          minWidth: theme.size.inspectorLabel,
          flexShrink: 0,
        }}
      >
        Align
      </span>
      <div style={{ display: "flex", gap: theme.spacing.xxs }}>
        {options.map((opt) => (
          <button
            key={opt}
            data-testid={`inspector-align-${opt}`}
            onClick={() => onChange(opt)}
            style={{
              background: value === opt ? theme.accent.primary : theme.bg.raised,
              color: value === opt ? theme.bg.base : theme.text.primary,
              border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
              borderRadius: theme.radius.xs,
              padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
              fontSize: theme.fontSize.xs,
              cursor: "pointer",
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
