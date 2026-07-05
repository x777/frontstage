import { useState } from "react";
import type { EditorStore, Clip } from "@frontstage/core";
import type { HueCurves } from "@frontstage/core";
import {
  findClip,
  parseHueCurves,
  isNeutralHueCurve,
  setEffectString,
  setClipEffectsCommand,
  resetSection,
  setSectionEnabled,
} from "@frontstage/core";
import { useStore } from "../../store/use-store.js";
import { AdjustSection } from "./AdjustSection.js";
import { HueCurveEditor } from "./HueCurveEditor.js";

const HUE_CURVES_TYPE = "color.hueCurves";

type HueChannel = "hueVsHue" | "hueVsSat" | "hueVsLum";

function serialize(curves: HueCurves): string {
  if (
    isNeutralHueCurve(curves.hueVsHue) &&
    isNeutralHueCurve(curves.hueVsSat) &&
    isNeutralHueCurve(curves.hueVsLum)
  ) {
    return ""; // empty string → setEffectString prunes the effect
  }
  return JSON.stringify(curves);
}

export interface HueCurvesSectionProps {
  store: EditorStore;
  clipIds: string[];
  hueHistogram?: number[];
}

export function HueCurvesSection({ store, clipIds, hueHistogram }: HueCurvesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [channel, setChannel] = useState<HueChannel>("hueVsHue");
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

  // Read curves from first clip; multi-clip shows first clip's curves, writes to all.
  const primaryClip = clips[0];
  const curvesStr =
    primaryClip?.effects?.find((e) => e.type === HUE_CURVES_TYPE)?.params["curves"]?.string ?? "";
  const curves = parseHueCurves(curvesStr);

  const canReset = clips.some((c) => c.effects?.some((e) => e.type === HUE_CURVES_TYPE));
  const sectionEnabled = !clips.some(
    (c) => c.effects?.some((e) => e.type === HUE_CURVES_TYPE && !e.enabled),
  );

  const handleChange = (nextCurves: HueCurves) => {
    const str = serialize(nextCurves);
    store.dispatch(
      setClipEffectsCommand(
        clipIds,
        (c) => setEffectString(c.effects, HUE_CURVES_TYPE, "curves", str, () => crypto.randomUUID()),
        "fx-color.hueCurves",
      ),
    );
  };

  return (
    <AdjustSection
      title="Hue Curves"
      expanded={expanded}
      onToggle={() => setExpanded((x) => !x)}
      canReset={canReset}
      onReset={() =>
        store.dispatch(
          setClipEffectsCommand(clipIds, (c) => resetSection(c.effects, [HUE_CURVES_TYPE])),
        )
      }
      enabled={sectionEnabled}
      onToggleEnabled={() =>
        store.dispatch(
          setClipEffectsCommand(
            clipIds,
            (c) => setSectionEnabled(c.effects, [HUE_CURVES_TYPE], !sectionEnabled),
          ),
        )
      }
      canEnable={canReset}
    >
      <HueCurveEditor
        curves={curves}
        channel={channel}
        onChannel={setChannel}
        onChange={handleChange}
        onCommit={() => {}}
        hueHistogram={hueHistogram}
      />
    </AdjustSection>
  );
}
