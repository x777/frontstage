import { useState, useRef, useEffect } from "react";
import type { EditorStore, Clip, CubeLUT } from "@palmier/core";
import {
  findClip,
  parseCubeLUT,
  effectDescriptor,
  sharedParamValue,
  setEffectParam,
  setEffectString,
  setSectionEnabled,
  resetSection,
  setClipEffectsCommand,
} from "@palmier/core";
import { useStore } from "../../store/use-store.js";
import { AdjustSection } from "./AdjustSection.js";
import { AdjustSlider } from "./AdjustSlider.js";
import { theme } from "../../theme/theme.js";
import type { LutReconciler } from "./lut-reconciler.js";

const LUT_TYPE = "color.lut";

export interface LUTSectionProps {
  store: EditorStore;
  clipIds: string[];
  engineRef?: { current: { registerLUT(path: string, cube: CubeLUT): void } | null };
  // .cube project persistence (M14C T2): when present, a picked file's bytes are stored into the
  // project (luts/<name>, unique-suffix on collision) and the STORED path is what gets referenced
  // and registered — absent, falls back to the bare filename (pre-M14C behavior).
  library?: { storeLut(filename: string, bytes: Uint8Array): Promise<string> };
  // Missing-.cube surfacing (M14C final-review Medium #3): shares the SAME reconciler instance that
  // re-registers LUTs on project load, so a permanently-missing/unparseable file (deleted from
  // disk, never persisted) shows "file missing" here instead of silently pretending it's loaded.
  reconciler?: LutReconciler;
}

export function LUTSection({ store, clipIds, engineRef, library, reconciler }: LUTSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [parseError, setParseError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timeline = useStore(store, (s) => s.timeline);
  // Force a re-render when the reconciler resolves an attempt (success or failure) — it's a plain
  // class, not observable state, so isFailed() wouldn't otherwise be re-read after a late failure.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!reconciler) return;
    return reconciler.subscribe(() => forceUpdate((n) => n + 1));
  }, [reconciler]);

  const clips: Clip[] = clipIds.flatMap((id) => {
    const loc = findClip(timeline, id);
    if (!loc) return [];
    const track = timeline.tracks[loc.trackIndex];
    if (!track) return [];
    const clip = track.clips[loc.clipIndex];
    if (!clip) return [];
    return [clip];
  });

  const firstPath = clips[0]?.effects?.find((e) => e.type === LUT_TYPE)?.params["path"]?.string ?? "";
  const allSamePath = clips.every(
    (c) => (c.effects?.find((e) => e.type === LUT_TYPE)?.params["path"]?.string ?? "") === firstPath,
  );
  const lutName = allSamePath ? (firstPath || "None") : "—";
  const lutMissing = allSamePath && firstPath !== "" && (reconciler?.isFailed(firstPath) ?? false);

  const d = effectDescriptor(LUT_TYPE);
  const intensitySpec = d?.params.find((p) => p.key === "intensity");
  const { min = 0, max = 1, default: def = 1 } = intensitySpec ?? {};
  const intensity = sharedParamValue(clips, LUT_TYPE, "intensity");

  const canReset = clips.some((c) => c.effects?.some((e) => e.type === LUT_TYPE));
  const sectionEnabled = !clips.some((c) => c.effects?.some((e) => e.type === LUT_TYPE && !e.enabled));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(false);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const cube = parseCubeLUT(text);
      if (!cube) {
        setParseError(true);
        if (fileInputRef.current) fileInputRef.current.value = ""; // allow re-picking the same file
        return;
      }
      const persistAndApply = async () => {
        const path = library ? await library.storeLut(file.name, new TextEncoder().encode(text)) : file.name;
        engineRef?.current?.registerLUT(path, cube);
        store.dispatch(
          setClipEffectsCommand(
            clipIds,
            (c) => setEffectString(c.effects, LUT_TYPE, "path", path, () => crypto.randomUUID()),
          ),
        );
      };
      void persistAndApply();
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  return (
    <AdjustSection
      title="LUTs"
      expanded={expanded}
      onToggle={() => setExpanded((x) => !x)}
      canReset={canReset}
      onReset={() =>
        store.dispatch(setClipEffectsCommand(clipIds, (c) => resetSection(c.effects, [LUT_TYPE])))
      }
      enabled={sectionEnabled}
      onToggleEnabled={() =>
        store.dispatch(
          setClipEffectsCommand(clipIds, (c) => setSectionEnabled(c.effects, [LUT_TYPE], !sectionEnabled)),
        )
      }
      canEnable={canReset}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xs }}>
        {/* File picker row */}
        <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs }}>
          <label
            style={{
              display: "inline-block",
              padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
              background: theme.bg.raised,
              border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
              borderRadius: theme.radius.xs,
              fontSize: theme.fontSize.xs,
              color: theme.text.primary,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".cube"
              data-testid="lut-file-input"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            Load .cube…
          </label>
          <span
            data-testid="lut-name"
            style={{
              flex: 1,
              fontSize: theme.fontSize.xs,
              color: lutName === "None" ? theme.text.muted : theme.text.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lutName}
          </span>
          {canReset && (
            <button
              data-testid="lut-remove"
              onClick={() =>
                store.dispatch(setClipEffectsCommand(clipIds, (c) => resetSection(c.effects, [LUT_TYPE])))
              }
              style={{
                background: "none",
                border: "none",
                padding: `0 ${theme.spacing.xxs}`,
                color: theme.text.secondary,
                fontSize: theme.fontSize.xs,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Remove
            </button>
          )}
        </div>

        {/* Parse error */}
        {parseError && (
          <span
            data-testid="lut-parse-error"
            style={{ fontSize: theme.fontSize.xs, color: theme.status.error }}
          >
            Invalid .cube file
          </span>
        )}

        {/* Missing file — the stored path resolved to nothing on the last load attempt */}
        {!parseError && lutMissing && (
          <span
            data-testid="lut-missing"
            style={{ fontSize: theme.fontSize.xs, color: theme.status.error }}
          >
            File missing — re-pick the .cube file
          </span>
        )}

        {/* Intensity slider */}
        <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs }}>
          <span
            style={{
              fontSize: theme.fontSize.sm,
              color: theme.text.secondary,
              minWidth: theme.size.adjustLabelCol,
              flexShrink: 0,
            }}
          >
            Intensity
          </span>
          <AdjustSlider
            value={intensity}
            min={min}
            max={max}
            def={def}
            onChange={(v) =>
              store.dispatch(
                setClipEffectsCommand(
                  clipIds,
                  (c) => setEffectParam(c.effects, LUT_TYPE, "intensity", v, () => crypto.randomUUID()),
                  "fx-color.lut-intensity",
                ),
              )
            }
            onCommit={() => {}}
          />
        </div>
      </div>
    </AdjustSection>
  );
}
