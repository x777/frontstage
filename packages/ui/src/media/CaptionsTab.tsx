import { useEffect, useMemo, useState } from "react";
import type { EditorStore, MediaManifestEntry, RGBA } from "@palmier/core";
import {
  TEXT_ANIMATION_PRESETS,
  DEFAULT_HIGHLIGHT_COLOR,
  transcriptTargets,
  timelineTrackDisplayLabel,
  defaultTextStyle,
  type TextAnimationPreset,
} from "@palmier/core";
import type { ToolContext, ToolResult } from "@palmier/ai";
import { canTranscribe, classifyRefsByCache, formatCredits } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { useStore } from "../store/use-store.js";
import { Select } from "../inspector/adjust/Select.js";
import { GeneratingOverlay, generatingLabel } from "./GeneratingOverlay.js";

const HIGHLIGHT_PRESETS: ReadonlySet<TextAnimationPreset> = new Set(["highlightPop", "highlightBlock"]);
const CENTER_SNAP_THRESHOLD = 0.02;
const TRACK_PREFIX = "track-";

function snapToHalf(v: number): number {
  return Math.abs(v - 0.5) <= CENTER_SNAP_THRESHOLD ? 0.5 : v;
}

function humanizePreset(id: TextAnimationPreset): string {
  if (id === "none") return "None";
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function rgbaToHex(rgba: RGBA): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(rgba.r)}${h(rgba.g)}${h(rgba.b)}`;
}

interface CaptionsLibrary {
  entry(mediaRef: string): MediaManifestEntry | undefined;
}

export type CaptionsExecutor = { execute(name: string, args: unknown): Promise<ToolResult> };
export type CaptionsTranscriptionFacade = NonNullable<ToolContext["transcription"]>;

export interface CaptionsTabProps {
  store: EditorStore;
  executor: CaptionsExecutor;
  transcription: CaptionsTranscriptionFacade;
  library: CaptionsLibrary;
}

interface Estimate {
  targetCount: number;
  uncachedCount: number;
  credits: number;
}

function textBlock(result: ToolResult): string {
  const block = result.blocks.find((b) => b.kind === "text");
  return block && block.kind === "text" ? block.text : "";
}

// add_captions' ok() payload is JSON with captionsAdded on the normal path, or a plain sentence
// ("No captions were generated…") on the no-speech path — summarize the former, pass the latter through.
function summarizeSuccess(text: string): string {
  try {
    const parsed = JSON.parse(text) as { captionsAdded?: number };
    if (typeof parsed.captionsAdded === "number") {
      const n = parsed.captionsAdded;
      return `${n} caption${n === 1 ? "" : "s"} added`;
    }
  } catch {
    // not JSON — show as-is
  }
  return text;
}

const labelStyle: React.CSSProperties = { fontSize: theme.fontSize.xxs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium };
const mutedStyle: React.CSSProperties = { fontSize: theme.fontSize.xxs, color: theme.text.muted, fontWeight: theme.fontWeight.regular };
const fieldGap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: theme.spacing.xxs };
const rowGap: React.CSSProperties = { display: "flex", gap: theme.spacing.xs };
const inputStyle: React.CSSProperties = {
  background: theme.bg.surface,
  border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
  borderRadius: theme.radius.xs,
  color: theme.text.primary,
  fontSize: theme.fontSize.xs,
  padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
};

export function CaptionsTab({ store, executor, transcription, library }: CaptionsTabProps) {
  const timeline = useStore(store, (s) => s.timeline);
  const selection = useStore(store, (s) => s.selection);

  const [source, setSource] = useState("auto");
  const [language, setLanguage] = useState("");
  const [textCase, setTextCase] = useState<"auto" | "upper" | "lower">("auto");
  const [maxWords, setMaxWords] = useState("");
  const [fontSize, setFontSize] = useState(48);
  const [fontName, setFontName] = useState(defaultTextStyle().fontName);
  const [color, setColor] = useState(rgbaToHex(defaultTextStyle().color));
  const [centerX, setCenterX] = useState(0.5);
  const [centerY, setCenterY] = useState(0.9);
  const [preset, setPreset] = useState<TextAnimationPreset>("none");
  const [highlightColor, setHighlightColor] = useState(rgbaToHex(DEFAULT_HIGHLIGHT_COLOR));

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    transcription
      .hasKey()
      .then((v) => { if (alive) setHasKey(v); })
      .catch(() => { if (alive) setHasKey(false); });
    return () => { alive = false; };
  }, [transcription]);

  // The "Selected clips" source only makes sense while there's a selection — fall back to auto if it's cleared.
  useEffect(() => {
    if (source === "selected" && selection.size === 0) setSource("auto");
  }, [source, selection]);

  // Same hasAudio-filtered pool add_captions itself resolves targets from (transcriptTargets + canTranscribe).
  const pool = useMemo(
    () => transcriptTargets(timeline).filter((t) => canTranscribe(library.entry(t.clip.mediaRef))),
    [timeline, library],
  );

  const trackOptions = useMemo(() => {
    const indices = [...new Set(pool.map((t) => t.trackIndex))].sort((a, b) => a - b);
    return indices.map((i) => ({ value: `${TRACK_PREFIX}${i}`, label: `Track ${timelineTrackDisplayLabel(timeline, i)}` }));
  }, [pool, timeline]);

  const sourceOptions = useMemo(() => {
    const opts = [{ value: "auto", label: "Auto-detect" }, ...trackOptions];
    if (selection.size > 0) opts.push({ value: "selected", label: "Selected clips" });
    return opts;
  }, [trackOptions, selection]);

  const targets = useMemo(() => {
    if (source === "auto") return pool;
    if (source === "selected") return pool.filter((t) => selection.has(t.clip.id));
    if (source.startsWith(TRACK_PREFIX)) {
      const idx = Number(source.slice(TRACK_PREFIX.length));
      return pool.filter((t) => t.trackIndex === idx);
    }
    return pool;
  }, [pool, source, selection]);

  // Live estimate: cache-first classify of the resolved targets' unique mediaRefs. `alive` discards
  // a stale in-flight classify if `targets`/`language` change again before it resolves.
  useEffect(() => {
    let alive = true;
    const uniqueRefs = [...new Set(targets.map((t) => t.clip.mediaRef))];
    if (uniqueRefs.length === 0) {
      setEstimate({ targetCount: 0, uncachedCount: 0, credits: 0 });
      return;
    }
    classifyRefsByCache(transcription, uniqueRefs, language.trim() || undefined).then(({ uncachedRefs }) => {
      if (!alive) return;
      const credits = uncachedRefs.reduce(
        (sum, ref) => sum + transcription.estimateCredits(library.entry(ref)?.duration ?? 0),
        0,
      );
      setEstimate({ targetCount: targets.length, uncachedCount: uncachedRefs.length, credits });
    });
    return () => { alive = false; };
  }, [targets, language, transcription, library]);

  const hasTargets = (estimate?.targetCount ?? 0) > 0;
  const uncachedCount = estimate?.uncachedCount ?? 0;
  const keyless = hasKey === false && uncachedCount > 0;
  const canGenerate = hasTargets && !keyless && !busy;

  function buildArgs(): Record<string, unknown> {
    const args: Record<string, unknown> = { confirm: true, textCase, fontSize, fontName, color, centerX, centerY };
    if (source === "selected") args.clipIds = [...selection];
    else if (source.startsWith(TRACK_PREFIX)) args.clipIds = targets.map((t) => t.clip.id);
    if (language.trim()) args.language = language.trim();
    if (maxWords.trim()) {
      const n = Math.floor(Number(maxWords));
      if (Number.isFinite(n) && n > 0) args.maxWords = n;
    }
    const animation: Record<string, unknown> = { preset };
    if (HIGHLIGHT_PRESETS.has(preset)) animation.highlightColor = highlightColor;
    args.animation = animation;
    return args;
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const result = await executor.execute("add_captions", buildArgs());
      const text = textBlock(result);
      if (result.isError) {
        setError(text);
        return;
      }
      setSuccess(summarizeSuccess(text));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="captions-tab" style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: theme.spacing.sm, display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
        <div style={fieldGap}>
          <span style={labelStyle}>Source</span>
          <Select
            testid="captions-source-select"
            value={source}
            options={sourceOptions}
            onChange={setSource}
          />
        </div>

        <div style={fieldGap}>
          <span style={labelStyle}>Language</span>
          <input
            data-testid="captions-language-input"
            type="text"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="Auto-detect (BCP-47, e.g. en, fr-CA)"
            style={inputStyle}
          />
        </div>

        <div style={rowGap}>
          <div style={{ ...fieldGap, flex: 1 }}>
            <span style={labelStyle}>Text case</span>
            <Select
              testid="captions-textcase-select"
              value={textCase}
              options={[{ value: "auto", label: "Auto" }, { value: "upper", label: "UPPER" }, { value: "lower", label: "lower" }]}
              onChange={setTextCase}
            />
          </div>
          <div style={{ ...fieldGap, flex: 1 }}>
            <span style={labelStyle}>Max words</span>
            <input
              data-testid="captions-maxwords-input"
              type="number"
              min={1}
              value={maxWords}
              onChange={(e) => setMaxWords(e.target.value)}
              placeholder="No limit"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={rowGap}>
          <div style={{ ...fieldGap, flex: 1 }}>
            <span style={labelStyle}>Font</span>
            <input
              data-testid="captions-fontname-input"
              type="text"
              value={fontName}
              onChange={(e) => setFontName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ ...fieldGap, width: "72px", flexShrink: 0 }}>
            <span style={labelStyle}>Size</span>
            <input
              data-testid="captions-fontsize-input"
              type="number"
              min={12}
              max={300}
              value={fontSize}
              onChange={(e) => setFontSize(Math.max(12, Math.min(300, Number(e.target.value) || 48)))}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={fieldGap}>
          <span style={labelStyle}>Color</span>
          <input
            data-testid="captions-color-input"
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={rowGap}>
          <div style={{ ...fieldGap, flex: 1 }}>
            <span style={labelStyle}>Center X</span>
            <input
              data-testid="captions-centerx-input"
              type="number"
              step={0.01}
              value={centerX}
              onChange={(e) => setCenterX(snapToHalf(Number(e.target.value)))}
              style={inputStyle}
            />
          </div>
          <div style={{ ...fieldGap, flex: 1 }}>
            <span style={labelStyle}>Center Y</span>
            <input
              data-testid="captions-centery-input"
              type="number"
              step={0.01}
              value={centerY}
              onChange={(e) => setCenterY(snapToHalf(Number(e.target.value)))}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={fieldGap}>
          <span style={labelStyle}>Animation</span>
          <Select
            testid="captions-preset-select"
            value={preset}
            options={TEXT_ANIMATION_PRESETS.map((p) => ({ value: p, label: humanizePreset(p) }))}
            onChange={setPreset}
          />
        </div>

        {HIGHLIGHT_PRESETS.has(preset) && (
          <div style={fieldGap}>
            <span style={labelStyle}>Highlight color</span>
            <input
              data-testid="captions-highlightcolor-input"
              type="text"
              value={highlightColor}
              onChange={(e) => setHighlightColor(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        <div data-testid="captions-estimate" style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium }}>
          {estimate === null
            ? ""
            : estimate.targetCount === 0
              ? "No transcribable clips for this source."
              : estimate.uncachedCount === 0
                ? "Cached — no credits used"
                : `Estimated cost: ${formatCredits(estimate.credits)}`}
        </div>

        {keyless && (
          <div data-testid="captions-key-hint" style={mutedStyle}>
            Set your fal.ai key in Settings to generate captions.
          </div>
        )}

        {error != null && (
          <div
            data-testid="captions-error"
            style={{
              fontSize: theme.fontSize.xs,
              color: theme.status.error,
              background: theme.bg.surface,
              border: `${theme.borderWidth.hairline} solid ${theme.status.error}`,
              borderRadius: theme.radius.xs,
              padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            }}
          >
            {error}
          </div>
        )}

        {success != null && (
          <div data-testid="captions-success" style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary }}>
            {success}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            data-testid="captions-generate"
            disabled={!canGenerate}
            onClick={handleGenerate}
            style={{
              background: theme.accent.primary,
              border: "none",
              borderRadius: theme.radius.xs,
              color: theme.text.onAccent,
              cursor: !canGenerate ? "not-allowed" : "pointer",
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.medium,
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              opacity: !canGenerate ? theme.opacity.disabled : theme.opacity.opaque,
            }}
          >
            Generate
          </button>
        </div>
      </div>

      {busy && <GeneratingOverlay label={generatingLabel({ kind: "transcribing" })} />}
    </div>
  );
}
