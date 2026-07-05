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
  effectParamLabel,
} from "@frontstage/core";
import { useStore } from "../../store/use-store.js";
import { AdjustSection } from "./AdjustSection.js";
import { AdjustmentRow } from "./AdjustmentRow.js";

interface SubgroupDef {
  title: string;
  types: string[];
}

const SUBGROUPS: SubgroupDef[] = [
  { title: "Detail",      types: ["blur.sharpen", "blur.noiseReduction", "detail.clarity"] },
  { title: "Blur",        types: ["blur.gaussian"] },
  { title: "Motion Blur", types: ["blur.motion"] },
  { title: "Vignette",    types: ["stylize.vignette"] },
  { title: "Film Grain",  types: ["stylize.grain"] },
  { title: "Glow",        types: ["stylize.glow"] },
  { title: "Chroma Key",  types: ["key.chroma"] },
];

export interface EffectsSectionProps {
  store: EditorStore;
  clipIds: string[];
}

export function EffectsSection({ store, clipIds }: EffectsSectionProps) {
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SUBGROUPS.map((sg) => [sg.title, false])),
  );
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

  return (
    <>
      {SUBGROUPS.map((sg) => {
        const expanded = expandedMap[sg.title] ?? false;
        const canReset = sg.types.some((type) =>
          clips.some((c) => c.effects?.some((e) => e.type === type)),
        );
        const sectionEnabled = !sg.types.some((type) =>
          clips.some((c) => c.effects?.some((e) => e.type === type && !e.enabled)),
        );

        return (
          <AdjustSection
            key={sg.title}
            title={sg.title}
            expanded={expanded}
            onToggle={() =>
              setExpandedMap((prev) => ({ ...prev, [sg.title]: !prev[sg.title] }))
            }
            canReset={canReset}
            onReset={() =>
              store.dispatch(
                setClipEffectsCommand(clipIds, (c) => resetSection(c.effects, sg.types)),
              )
            }
            enabled={sectionEnabled}
            onToggleEnabled={() =>
              store.dispatch(
                setClipEffectsCommand(
                  clipIds,
                  (c) => setSectionEnabled(c.effects, sg.types, !sectionEnabled),
                ),
              )
            }
            canEnable={canReset}
          >
            {sg.types.flatMap((type) => {
              const d = effectDescriptor(type);
              if (!d) return [];
              return d.params.map((spec) => {
                const value = sharedParamValue(clips, type, spec.key);
                const gradient =
                  type === "key.chroma" && spec.key === "keyHue" ? "hue" : "none";
                return (
                  <AdjustmentRow
                    key={`${type}:${spec.key}`}
                    label={effectParamLabel(type, spec.key)}
                    value={value}
                    min={spec.min}
                    max={spec.max}
                    def={spec.default}
                    gradient={gradient}
                    onChange={(v) =>
                      store.dispatch(
                        setClipEffectsCommand(
                          clipIds,
                          (c) =>
                            setEffectParam(
                              c.effects,
                              type,
                              spec.key,
                              v,
                              () => crypto.randomUUID(),
                            ),
                          `fx-${type}-${spec.key}`,
                        ),
                      )
                    }
                    onCommit={() => {}}
                    format={(v) => formatParam(v, spec.min, spec.max)}
                  />
                );
              });
            })}
          </AdjustSection>
        );
      })}
    </>
  );
}
