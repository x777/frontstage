import { useState } from "react";
import type { EditorStore, Clip } from "@frontstage/core";
import type { GradeCurve } from "@frontstage/core";
import {
  findClip,
  parseGradeCurve,
  isIdentityCurve,
  setEffectString,
  setClipEffectsCommand,
  resetSection,
  setSectionEnabled,
} from "@frontstage/core";
import { useStore } from "../../store/use-store.js";
import { AdjustSection } from "./AdjustSection.js";
import { CurveEditor } from "./CurveEditor.js";

const CURVES_TYPE = "color.curves";

type Channel = "master" | "red" | "green" | "blue";

function serialize(curve: GradeCurve): string {
  if (
    isIdentityCurve(curve.master) &&
    isIdentityCurve(curve.red) &&
    isIdentityCurve(curve.green) &&
    isIdentityCurve(curve.blue)
  ) {
    return ""; // empty string → setEffectString prunes the effect
  }
  return JSON.stringify(curve);
}

export interface CurvesSectionProps {
  store: EditorStore;
  clipIds: string[];
  histogram?: { y: number[]; r: number[]; g: number[]; b: number[] };
}

export function CurvesSection({ store, clipIds, histogram }: CurvesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [channel, setChannel] = useState<Channel>("master");
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

  // Read curve from first clip; multi-clip shows first clip's curve, writes to all.
  const primaryClip = clips[0];
  const curveStr =
    primaryClip?.effects?.find((e) => e.type === CURVES_TYPE)?.params["curve"]?.string ?? "";
  const curve = parseGradeCurve(curveStr);

  const canReset = clips.some((c) => c.effects?.some((e) => e.type === CURVES_TYPE));
  const sectionEnabled = !clips.some(
    (c) => c.effects?.some((e) => e.type === CURVES_TYPE && !e.enabled),
  );

  const handleChange = (nextCurve: GradeCurve) => {
    const str = serialize(nextCurve);
    store.dispatch(
      setClipEffectsCommand(
        clipIds,
        (c) => setEffectString(c.effects, CURVES_TYPE, "curve", str, () => crypto.randomUUID()),
        "fx-color.curves",
      ),
    );
  };

  return (
    <AdjustSection
      title="Curves"
      expanded={expanded}
      onToggle={() => setExpanded((x) => !x)}
      canReset={canReset}
      onReset={() =>
        store.dispatch(
          setClipEffectsCommand(clipIds, (c) => resetSection(c.effects, [CURVES_TYPE])),
        )
      }
      enabled={sectionEnabled}
      onToggleEnabled={() =>
        store.dispatch(
          setClipEffectsCommand(
            clipIds,
            (c) => setSectionEnabled(c.effects, [CURVES_TYPE], !sectionEnabled),
          ),
        )
      }
      canEnable={canReset}
    >
      <CurveEditor
        curve={curve}
        channel={channel}
        onChannel={setChannel}
        onChange={handleChange}
        onCommit={() => {}}
        histogram={histogram}
      />
    </AdjustSection>
  );
}
