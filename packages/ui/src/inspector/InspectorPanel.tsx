import { useState, useEffect } from "react";
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
import type { PlaybackEngine } from "@palmier/engine";
import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";
import { SegmentedTabs } from "../primitives/index.js";
import { NumberField, SliderField, ToggleField, TextField, Section, rowStyle, labelStyle } from "./fields.js";
import { KeyframeLanes } from "./KeyframeLanes.js";
import { BasicCorrectionSection } from "./adjust/BasicCorrectionSection.js";
import { CurvesSection } from "./adjust/CurvesSection.js";
import { ColorWheelsSection } from "./adjust/ColorWheelsSection.js";
import { HueCurvesSection } from "./adjust/HueCurvesSection.js";
import { LUTSection } from "./adjust/LUTSection.js";
import { EffectsSection } from "./adjust/EffectsSection.js";
import { BlendControl } from "./adjust/BlendControl.js";
import { computeFrameHistograms } from "./adjust/frame-histogram.js";
import type { LutReconciler } from "./adjust/lut-reconciler.js";

interface MediaLibraryLike {
  entry(id: string): MediaManifestEntry | undefined;
  // .cube project persistence (M14C T2) — see LUTSection's `library` prop.
  storeLut?(filename: string, bytes: Uint8Array): Promise<string>;
}

export interface InspectorPanelProps {
  store: EditorStore;
  library?: MediaLibraryLike;
  engineRef?: { current: PlaybackEngine | null };
  // Missing-.cube surfacing (M14C final-review Medium #3) — see LUTSection's `reconciler` prop.
  lutReconciler?: LutReconciler;
}

type Histogram = { y: number[]; r: number[]; g: number[]; b: number[] };

const VISUAL_TYPES = new Set(["video", "image", "text", "lottie"]);
const AUDIO_TYPES = new Set(["audio", "video"]);

function rgbaToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function isNonTextVisual(c: Clip): boolean {
  return VISUAL_TYPES.has(c.mediaType) && c.mediaType !== "text";
}

export function InspectorPanel({ store, library, engineRef, lutReconciler }: InspectorPanelProps) {
  const selection = useStore(store, (s) => s.selection);
  const playhead = useStore(store, (s) => s.playhead);
  const timeline = useStore(store, (s) => s.timeline);
  const lutLibrary = library?.storeLut ? { storeLut: library.storeLut.bind(library) } : undefined;

  const [histogram, setHistogram] = useState<Histogram | undefined>(undefined);
  const [hueHistogram, setHueHistogram] = useState<number[] | undefined>(undefined);

  useEffect(() => {
    const engine = engineRef?.current;
    if (!engine) return;
    let cancelled = false;
    void computeFrameHistograms(engine)
      .then(({ yrgb, hue }) => {
        if (!cancelled) {
          setHistogram(yrgb);
          setHueHistogram(hue);
        }
      })
      .catch(() => {}); // engine may be torn down mid-read
    return () => { cancelled = true; };
  }, [engineRef, playhead, timeline, selection]);

  // Swift has no literal "nothing selected" placeholder (InspectorView falls back to project
  // metadata) — the closest analog is marqueeSelectionSummary's centered sm/tertiary text.
  const emptyState = (
    <div
      data-testid="inspector-empty"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.tertiary,
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
          <CurvesSection store={store} clipIds={selIds} histogram={histogram} />
          <ColorWheelsSection store={store} clipIds={selIds} />
          <HueCurvesSection store={store} clipIds={selIds} hueHistogram={hueHistogram} />
          <LUTSection store={store} clipIds={selIds} engineRef={engineRef} library={lutLibrary} reconciler={lutReconciler} />
          <EffectsSection store={store} clipIds={selIds} />
          <BlendControl store={store} clipIds={selIds} />
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
        <CurvesSection store={store} clipIds={[clipId]} histogram={histogram} />
      )}

      {/* Color Wheels */}
      {isVisual && !isText && (
        <ColorWheelsSection store={store} clipIds={[clipId]} />
      )}

      {/* Hue Curves */}
      {isVisual && !isText && (
        <HueCurvesSection store={store} clipIds={[clipId]} hueHistogram={hueHistogram} />
      )}

      {/* LUT */}
      {isVisual && !isText && (
        <LUTSection store={store} clipIds={[clipId]} engineRef={engineRef} library={lutLibrary} reconciler={lutReconciler} />
      )}

      {/* Effects */}
      {isVisual && !isText && (
        <EffectsSection store={store} clipIds={[clipId]} />
      )}

      {/* Blend */}
      {isVisual && !isText && (
        <BlendControl store={store} clipIds={[clipId]} />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span
        style={{
          fontSize: theme.fontSize.sm,
          color: theme.text.secondary,
          flex: 1,
          minWidth: 0,
          textAlign: "right",
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

const alignmentSegments: readonly { id: TextAlignment; label: string }[] = [
  { id: "left", label: "left" },
  { id: "center", label: "center" },
  { id: "right", label: "right" },
];

function AlignmentField({ value, onChange }: { value: TextAlignment; onChange: (v: TextAlignment) => void }) {
  return (
    <div data-testid="inspector-alignment" style={rowStyle}>
      <span style={labelStyle}>Align</span>
      <span style={{ flex: 1 }} />
      <SegmentedTabs segments={alignmentSegments} active={value} onSelect={(id) => onChange(id as TextAlignment)} testid="inspector-align" />
    </div>
  );
}
