import { useState } from "react";
import type { EditorStore, Clip } from "@frontstage/core";
import {
  findClip,
  resetSection,
  setSectionEnabled,
  setClipEffectsCommand,
} from "@frontstage/core";
import { useStore } from "../../store/use-store.js";
import { theme } from "../../theme/theme.js";
import { AdjustSection } from "./AdjustSection.js";
import { ColorWheelControl } from "./ColorWheelControl.js";

const WHEELS_TYPE = "color.wheels";

export interface ColorWheelsSectionProps {
  store: EditorStore;
  clipIds: string[];
}

export function ColorWheelsSection({ store, clipIds }: ColorWheelsSectionProps) {
  const [expanded, setExpanded] = useState(false);
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

  const canReset = clips.some((c) => c.effects?.some((e) => e.type === WHEELS_TYPE));
  const sectionEnabled = !clips.some(
    (c) => c.effects?.some((e) => e.type === WHEELS_TYPE && !e.enabled),
  );

  return (
    <AdjustSection
      title="Color Wheels"
      expanded={expanded}
      onToggle={() => setExpanded((x) => !x)}
      canReset={canReset}
      onReset={() =>
        store.dispatch(
          setClipEffectsCommand(clipIds, (c) => resetSection(c.effects, [WHEELS_TYPE])),
        )
      }
      enabled={sectionEnabled}
      onToggleEnabled={() =>
        store.dispatch(
          setClipEffectsCommand(clipIds, (c) =>
            setSectionEnabled(c.effects, [WHEELS_TYPE], !sectionEnabled),
          ),
        )
      }
      canEnable={canReset}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: theme.spacing.sm,
          justifyContent: "space-between",
          padding: `${theme.spacing.xxs} 0`,
        }}
      >
        <ColorWheelControl store={store} clipIds={clipIds} title="Lift"  prefix="lift"  />
        <ColorWheelControl store={store} clipIds={clipIds} title="Gamma" prefix="gamma" />
        <ColorWheelControl store={store} clipIds={clipIds} title="Gain"  prefix="gain"  />
      </div>
    </AdjustSection>
  );
}
