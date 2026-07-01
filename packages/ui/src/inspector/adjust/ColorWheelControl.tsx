import type { EditorStore, Clip } from "@palmier/core";
import {
  findClip,
  effectDescriptor,
  sharedParamValue,
  setEffectParam,
  setClipEffectsCommand,
  formatParam,
} from "@palmier/core";
import { useStore } from "../../store/use-store.js";
import { theme } from "../../theme/theme.js";
import { ColorWheelPad } from "./ColorWheelPad.js";
import { AdjustSlider } from "./AdjustSlider.js";
import { ScrubbableNumberField } from "./ScrubbableNumberField.js";

// Numeric size — matches --size-color-wheel-pad (96px)
const PAD_SIZE = 96;

export interface ColorWheelControlProps {
  store: EditorStore;
  clipIds: string[];
  title: string;
  prefix: "lift" | "gamma" | "gain";
}

export function ColorWheelControl({ store, clipIds, title, prefix }: ColorWheelControlProps) {
  const timeline = useStore(store, (s) => s.timeline);

  const clips: Clip[] = clipIds.flatMap((id) => {
    const loc = findClip(timeline, id);
    if (!loc) return [];
    const track = timeline.tracks[loc.trackIndex];
    if (!track) return [];
    const clip = track.clips[loc.clipIndex];
    if (!clip) return [];
    return [clip];
  });

  const x = sharedParamValue(clips, "color.wheels", `${prefix}_x`) ?? 0;
  const y = sharedParamValue(clips, "color.wheels", `${prefix}_y`) ?? 0;
  const mValue = sharedParamValue(clips, "color.wheels", `${prefix}_m`);

  const d = effectDescriptor("color.wheels");
  const mSpec = d?.params.find((p) => p.key === `${prefix}_m`);
  if (!mSpec) return null;

  const newId = () => crypto.randomUUID();

  return (
    <div
      data-testid={`wheel-control-${prefix}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.spacing.xs,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: theme.fontSize.xxs,
          color: theme.text.secondary,
          fontWeight: theme.fontWeight.medium,
          userSelect: "none",
        }}
      >
        {title}
      </div>

      <ColorWheelPad
        x={x}
        y={y}
        size={PAD_SIZE}
        title={title}
        onChange={(nx, ny) =>
          store.dispatch(
            setClipEffectsCommand(
              clipIds,
              (c) => {
                let e = setEffectParam(c.effects, "color.wheels", `${prefix}_x`, nx, newId);
                return setEffectParam(e, "color.wheels", `${prefix}_y`, ny, newId);
              },
              `fx-color.wheels-${prefix}-xy`,
            ),
          )
        }
        onCommit={() => {}}
      />

      <div
        data-testid={`wheel-luma-${prefix}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.spacing.xs,
          width: "100%",
        }}
      >
        <AdjustSlider
          value={mValue}
          min={mSpec.min}
          max={mSpec.max}
          def={mSpec.default}
          gradient="luma"
          onChange={(v) =>
            store.dispatch(
              setClipEffectsCommand(
                clipIds,
                (c) => setEffectParam(c.effects, "color.wheels", `${prefix}_m`, v, newId),
                `fx-color.wheels-${prefix}-m`,
              ),
            )
          }
          onCommit={() => {}}
        />
        <ScrubbableNumberField
          value={mValue}
          min={mSpec.min}
          max={mSpec.max}
          onChange={(v) =>
            store.dispatch(
              setClipEffectsCommand(
                clipIds,
                (c) => setEffectParam(c.effects, "color.wheels", `${prefix}_m`, v, newId),
                `fx-color.wheels-${prefix}-m`,
              ),
            )
          }
          onCommit={() => {}}
          format={(v) => formatParam(v, mSpec.min, mSpec.max)}
        />
      </div>
    </div>
  );
}
