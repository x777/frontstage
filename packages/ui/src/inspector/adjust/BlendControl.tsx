import type { EditorStore } from "@palmier/core";
import { findClip, BLEND_MODES, setClipBlendModeCommand } from "@palmier/core";
import type { BlendMode } from "@palmier/core";
import { useStore } from "../../store/use-store.js";
import { Select } from "./Select.js";
import { theme } from "../../theme/theme.js";

const BLEND_LABELS: Record<BlendMode, string> = {
  normal:     "Normal",
  darken:     "Darken",
  multiply:   "Multiply",
  colorBurn:  "Color Burn",
  lighten:    "Lighten",
  screen:     "Screen",
  colorDodge: "Color Dodge",
  overlay:    "Overlay",
  softLight:  "Soft Light",
  hardLight:  "Hard Light",
  difference: "Difference",
  exclusion:  "Exclusion",
  hue:        "Hue",
  saturation: "Saturation",
  color:      "Color",
  luminosity: "Luminosity",
};

const BLEND_OPTIONS = BLEND_MODES.map((m) => ({ value: m, label: BLEND_LABELS[m] }));

export interface BlendControlProps {
  store: EditorStore;
  clipIds: string[];
}

export function BlendControl({ store, clipIds }: BlendControlProps) {
  const timeline = useStore(store, (s) => s.timeline);

  const clips = clipIds.flatMap((id) => {
    const loc = findClip(timeline, id);
    if (!loc) return [];
    const track = timeline.tracks[loc.trackIndex];
    if (!track) return [];
    const clip = track.clips[loc.clipIndex];
    if (!clip) return [];
    return [clip];
  });

  let sharedMode: BlendMode | null = null;
  if (clips.length > 0) {
    const first = clips[0]!.blendMode ?? "normal";
    sharedMode = clips.every((c) => (c.blendMode ?? "normal") === first) ? first : null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
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
        Blend
      </span>
      <Select<BlendMode>
        value={sharedMode}
        options={BLEND_OPTIONS}
        placeholder="—"
        onChange={(mode) => store.dispatch(setClipBlendModeCommand(clipIds, mode))}
      />
    </div>
  );
}
