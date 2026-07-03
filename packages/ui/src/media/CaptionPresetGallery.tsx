import { useEffect, useState } from "react";
import { TEXT_ANIMATION_PRESETS, type TextAnimationPreset } from "@palmier/core";
import { theme } from "../theme/theme.js";

const HIGHLIGHT_PRESETS: ReadonlySet<TextAnimationPreset> = new Set(["highlightPop", "highlightBlock"]);

export function isHighlightPreset(preset: TextAnimationPreset): boolean {
  return HIGHLIGHT_PRESETS.has(preset);
}

export function humanizePresetLabel(id: TextAnimationPreset): string {
  if (id === "none") return "None";
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

// TEXT_ANIMATION_PRESETS is [none, fadeIn, popIn, slideUp, typewriter, ...perWord] — matches Swift's
// CaptionPresetGallery "Per line" (first 5) / "Per word" (remaining 6) grouping.
const PER_LINE = TEXT_ANIMATION_PRESETS.slice(0, 5);
const PER_WORD = TEXT_ANIMATION_PRESETS.slice(5);

const PREVIEW_WORDS = ["Word", "by", "word"];
// Per-word stagger, seconds — kept in sync with --anim-preset-preview-solo-duration (1.5s = 3 * 0.5s)
// in tokens.css. Not itself a design token: it's an index multiplier, not a fixed duration.
const WORD_STAGGER_SECONDS = 0.5;

type PreviewFamily =
  | "static" | "clip-fade" | "clip-pop" | "clip-slide"
  | "word-fade" | "word-slide" | "word-pop" | "word-instant"
  | "solo" | "highlight-pop" | "highlight-block";

function previewFamily(preset: TextAnimationPreset): PreviewFamily {
  switch (preset) {
    case "none": return "static";
    case "fadeIn": return "clip-fade";
    case "popIn": return "clip-pop";
    case "slideUp": return "clip-slide";
    case "typewriter": return "word-instant";
    case "wordReveal": return "word-fade";
    case "wordSlide": return "word-slide";
    case "wordPop": return "word-pop";
    case "wordCycle": return "solo";
    case "highlightPop": return "highlight-pop";
    case "highlightBlock": return "highlight-block";
  }
}

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: theme.fontSize.xxs,
  color: theme.text.tertiary,
  fontWeight: theme.fontWeight.semibold,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${theme.size.presetCardMin}, 1fr))`,
  gap: theme.spacing.xs,
};

const sampleTextStyle: React.CSSProperties = {
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.text.primary,
};

export interface CaptionPresetGalleryProps {
  preset: TextAnimationPreset;
  onPreset: (p: TextAnimationPreset) => void;
  highlightColor: string;
  onHighlightColor: (hex: string) => void;
}

export function CaptionPresetGallery({ preset, onPreset, highlightColor, onHighlightColor }: CaptionPresetGalleryProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
      <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
        <span style={sectionLabelStyle}>Per line</span>
        <div data-testid="captions-preset-gallery" style={gridStyle}>
          {PER_LINE.map((id) => (
            <PresetCard key={id} id={id} selected={preset === id} onSelect={onPreset} />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
        <span style={sectionLabelStyle}>Per word</span>
        <div style={gridStyle}>
          {PER_WORD.map((id) => (
            <PresetCard key={id} id={id} selected={preset === id} onSelect={onPreset} />
          ))}
        </div>
      </div>

      {/* CSS approximation of the selected preset's family — the engine's timeline render is the truth. */}
      <PresetPreview preset={preset} highlightColor={highlightColor} reducedMotion={reducedMotion} />

      {isHighlightPreset(preset) && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
          <span style={{ fontSize: theme.fontSize.xxs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium }}>
            Highlight color
          </span>
          <div style={{ display: "flex", gap: theme.spacing.xs, alignItems: "center" }}>
            <span
              data-testid="captions-highlightcolor-swatch"
              style={{
                width: theme.size.colorSwatch,
                height: theme.size.colorSwatch,
                flexShrink: 0,
                borderRadius: theme.radius.xs,
                background: highlightColor,
                border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
              }}
            />
            <input
              data-testid="captions-highlightcolor-input"
              type="text"
              value={highlightColor}
              onChange={(e) => onHighlightColor(e.target.value)}
              style={{
                flex: 1,
                background: theme.bg.surface,
                border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
                borderRadius: theme.radius.xs,
                color: theme.text.primary,
                fontSize: theme.fontSize.xs,
                padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                outline: "none",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PresetCard({ id, selected, onSelect }: { id: TextAnimationPreset; selected: boolean; onSelect: (p: TextAnimationPreset) => void }) {
  return (
    <button
      type="button"
      data-testid={`captions-preset-${id}`}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${theme.spacing.xs} ${theme.spacing.xxs}`,
        background: theme.bg.raised,
        border: `${selected ? theme.borderWidth.medium : theme.borderWidth.hairline} solid ${selected ? theme.accent.timecode : theme.border.subtle}`,
        borderRadius: theme.radius.sm,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontSize: theme.fontSize.xxs,
          fontWeight: selected ? theme.fontWeight.semibold : theme.fontWeight.regular,
          color: selected ? theme.text.primary : theme.text.tertiary,
          textAlign: "center",
        }}
      >
        {humanizePresetLabel(id)}
      </span>
    </button>
  );
}

function PresetPreview({ preset, highlightColor, reducedMotion }: { preset: TextAnimationPreset; highlightColor: string; reducedMotion: boolean }) {
  const family = previewFamily(preset);
  return (
    <div
      data-testid="captions-preset-preview"
      data-reduced-motion={reducedMotion}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: theme.size.presetPreviewHeight,
        background: theme.bg.surface,
        border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
        borderRadius: theme.radius.sm,
        overflow: "hidden",
      }}
    >
      {family === "static" && <span style={sampleTextStyle}>{PREVIEW_WORDS.join(" ")}</span>}

      {(family === "clip-fade" || family === "clip-pop" || family === "clip-slide") && (
        <span
          data-preset-anim
          style={{
            ...sampleTextStyle,
            animation: reducedMotion ? "none" : `preset-${family} ${theme.anim.presetPreviewDuration} ease-in-out infinite`,
          }}
        >
          {PREVIEW_WORDS.join(" ")}
        </span>
      )}

      {(family === "word-fade" || family === "word-slide" || family === "word-pop" || family === "word-instant") && (
        <span style={{ display: "flex", gap: theme.spacing.xxs }}>
          {PREVIEW_WORDS.map((w, i) => (
            <span
              key={i}
              data-preset-anim
              style={{
                ...sampleTextStyle,
                animation: reducedMotion ? "none" : `preset-${family} ${theme.anim.presetPreviewDuration} ease-out infinite`,
                animationDelay: `${i * WORD_STAGGER_SECONDS}s`,
              }}
            >
              {w}
            </span>
          ))}
        </span>
      )}

      {family === "solo" && (
        <span style={{ display: "flex", gap: theme.spacing.xxs }}>
          {PREVIEW_WORDS.map((w, i) => (
            <span
              key={i}
              data-preset-anim
              style={{
                ...sampleTextStyle,
                animation: reducedMotion ? "none" : `preset-solo-window ${theme.anim.presetPreviewSoloDuration} steps(1, end) infinite`,
                animationDelay: `${-(i * WORD_STAGGER_SECONDS)}s`,
              }}
            >
              {w}
            </span>
          ))}
        </span>
      )}

      {(family === "highlight-pop" || family === "highlight-block") && (
        <span style={{ display: "flex", gap: theme.spacing.xxs }}>
          {PREVIEW_WORDS.map((w, i) => (
            <span key={i} style={{ position: "relative", padding: `0 ${theme.spacing.xxs}` }}>
              <span
                data-preset-anim
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: theme.radius.xs,
                  background: highlightColor,
                  animation: reducedMotion ? "none" : `preset-solo-window ${theme.anim.presetPreviewSoloDuration} steps(1, end) infinite`,
                  animationDelay: `${-(i * WORD_STAGGER_SECONDS)}s`,
                }}
              />
              <span
                data-preset-anim={family === "highlight-pop" ? true : undefined}
                style={{
                  ...sampleTextStyle,
                  position: "relative",
                  display: "inline-block",
                  ...(family === "highlight-pop"
                    ? {
                        animation: reducedMotion ? "none" : `preset-solo-scale ${theme.anim.presetPreviewSoloDuration} steps(1, end) infinite`,
                        animationDelay: `${-(i * WORD_STAGGER_SECONDS)}s`,
                      }
                    : {}),
                }}
              >
                {w}
              </span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
