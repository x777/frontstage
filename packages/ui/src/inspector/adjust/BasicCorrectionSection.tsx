import { useState } from "react";
import type { EditorStore, Clip } from "@frontstage/core";
import {
  findClip,
  effectDescriptor,
  sharedParamValue,
  setEffectParam,
  setSectionEnabled,
  resetSection,
  setClipEffectsCommand,
  formatParam,
} from "@frontstage/core";
import { useStore } from "../../store/use-store.js";
import { AdjustSection } from "./AdjustSection.js";
import { AdjustmentRow } from "./AdjustmentRow.js";
import { theme } from "../../theme/theme.js";

const BASIC_TYPES = [
  "color.exposure",
  "color.contrast",
  "color.highlightsShadows",
  "color.blacksWhites",
  "color.temperature",
  "color.vibrance",
  "color.saturation",
];

interface RowDef {
  label: string;
  type: string;
  key: string;
  gradient: "temperature" | "tint" | "luma" | "none";
  group: "Tone" | "White Balance" | "Presence";
}

const ROWS: RowDef[] = [
  { label: "Exposure",    type: "color.exposure",          key: "ev",          gradient: "none",        group: "Tone" },
  { label: "Contrast",   type: "color.contrast",          key: "amount",      gradient: "none",        group: "Tone" },
  { label: "Highlights", type: "color.highlightsShadows", key: "highlights",  gradient: "none",        group: "Tone" },
  { label: "Shadows",    type: "color.highlightsShadows", key: "shadows",     gradient: "none",        group: "Tone" },
  { label: "Blacks",     type: "color.blacksWhites",      key: "blacks",      gradient: "none",        group: "Tone" },
  { label: "Whites",     type: "color.blacksWhites",      key: "whites",      gradient: "none",        group: "Tone" },
  { label: "Temperature", type: "color.temperature",      key: "temperature", gradient: "temperature", group: "White Balance" },
  { label: "Tint",       type: "color.temperature",       key: "tint",        gradient: "tint",        group: "White Balance" },
  { label: "Vibrance",   type: "color.vibrance",          key: "amount",      gradient: "none",        group: "Presence" },
  { label: "Saturation", type: "color.saturation",        key: "amount",      gradient: "none",        group: "Presence" },
];

const GROUPS: Array<"Tone" | "White Balance" | "Presence"> = ["Tone", "White Balance", "Presence"];

export interface BasicCorrectionSectionProps {
  store: EditorStore;
  clipIds: string[];
}

export function BasicCorrectionSection({ store, clipIds }: BasicCorrectionSectionProps) {
  const [expanded, setExpanded] = useState(true);
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

  const canReset = BASIC_TYPES.some((type) =>
    clips.some((c) => c.effects?.some((e) => e.type === type)),
  );

  const sectionEnabled = !BASIC_TYPES.some((type) =>
    clips.some((c) => c.effects?.some((e) => e.type === type && !e.enabled)),
  );

  return (
    <AdjustSection
      title="Basic Correction"
      expanded={expanded}
      onToggle={() => setExpanded((x) => !x)}
      canReset={canReset}
      onReset={() =>
        store.dispatch(setClipEffectsCommand(clipIds, (c) => resetSection(c.effects, BASIC_TYPES)))
      }
      enabled={sectionEnabled}
      onToggleEnabled={() =>
        store.dispatch(
          setClipEffectsCommand(clipIds, (c) => setSectionEnabled(c.effects, BASIC_TYPES, !sectionEnabled)),
        )
      }
      canEnable={canReset}
    >
      {GROUPS.map((group) => (
        <div key={group}>
          <div
            style={{
              fontSize: theme.fontSize.xxs,
              color: theme.text.muted,
              fontWeight: theme.fontWeight.medium,
              letterSpacing: theme.letterSpacing.wide,
              textTransform: "uppercase",
              padding: `${theme.spacing.xs} 0 ${theme.spacing.xxs}`,
            }}
          >
            {group}
          </div>
          {ROWS.filter((r) => r.group === group).map((row) => {
            const d = effectDescriptor(row.type);
            const paramSpec = d?.params.find((p) => p.key === row.key);
            if (!paramSpec) return null;
            const { min, max, default: def } = paramSpec;
            const value = sharedParamValue(clips, row.type, row.key);
            return (
              <AdjustmentRow
                key={`${row.type}:${row.key}`}
                label={row.label}
                value={value}
                min={min}
                max={max}
                def={def}
                gradient={row.gradient}
                onChange={(v) =>
                  store.dispatch(
                    setClipEffectsCommand(
                      clipIds,
                      (c) => setEffectParam(c.effects, row.type, row.key, v, () => crypto.randomUUID()),
                      `fx-${row.type}-${row.key}`,
                    ),
                  )
                }
                onCommit={() => {}}
                format={(v) => formatParam(v, min, max)}
              />
            );
          })}
        </div>
      ))}
    </AdjustSection>
  );
}
