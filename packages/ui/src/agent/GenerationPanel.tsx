import { useEffect, useMemo, useState } from "react";
import type { GenerationInput, MediaManifestEntry } from "@palmier/core";
import { createPlaceholderEntry } from "@palmier/core";
import type { GenModelEntry, GenModelKind, GenToolParams, StartJobArgs } from "@palmier/ai";
import { genModel, listGenModels, validateGenParams, estimateCredits, formatCredits } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { Select } from "../inspector/adjust/Select.js";

const IMAGE_DURATION_SECONDS = 5; // mirrors generate-image-tool.ts

const KIND_TABS: { kind: GenModelKind; label: string }[] = [
  { kind: "video", label: "Video" },
  { kind: "image", label: "Image" },
  { kind: "audio", label: "Audio" },
  { kind: "upscale", label: "Upscale" },
];

const PROMPT_PLACEHOLDER: Record<GenModelKind, string> = {
  video: "Describe the video…",
  image: "Describe the image…",
  audio: "Text to speak, or a style description…",
  upscale: "",
};

// The exact ToolContext["generation"] shape — the manual panel submits through the same facade the tools use.
export interface GenerationFacade {
  hasKey(): Promise<boolean>;
  addPlaceholder(entry: MediaManifestEntry): void;
  startJob(args: StartJobArgs): Promise<{ jobId: string } | { error: string }>;
  entryUrl?(mediaRef: string): Promise<string | undefined>;
  confirmThreshold: number;
}

export interface GenerationPanelProps {
  generation: GenerationFacade;
  newId: () => string;
  entries?: () => MediaManifestEntry[];
  onClose?: () => void;
}

// Builds the full-sentinel GenerationInput placeholder(s) the SAME way generate-tools.ts does —
// only called after validateGenParams already passed, so params are known-valid here.
function buildPlaceholders(entry: GenModelEntry, params: GenToolParams, newId: () => string): MediaManifestEntry[] {
  const createdAt = new Date().toISOString();

  if (entry.kind === "video") {
    const duration = params.duration ?? entry.caps.durations?.[0] ?? 5;
    const genInput: GenerationInput = {
      prompt: params.prompt ?? "",
      model: entry.endpoint,
      duration,
      aspectRatio: params.aspectRatio ?? "",
      resolution: params.resolution,
      createdAt,
    };
    return [
      createPlaceholderEntry({ id: newId(), type: "video", name: (params.prompt ?? "").slice(0, 30), duration, ext: "mp4", genInput }),
    ];
  }

  if (entry.kind === "audio") {
    const duration = params.duration ?? (entry.caps.supportsLyrics ? 60 : 10);
    const genInput: GenerationInput = {
      prompt: params.prompt ?? "",
      model: entry.endpoint,
      duration,
      aspectRatio: "",
      voice: params.voice,
      lyrics: params.lyrics,
      instrumental: params.instrumental,
      createdAt,
    };
    return [
      createPlaceholderEntry({ id: newId(), type: "audio", name: (params.prompt ?? "").slice(0, 30), duration, ext: "mp3", genInput }),
    ];
  }

  if (entry.kind === "image") {
    const numImages = params.numImages ?? 1;
    const baseName = (params.prompt ?? "").slice(0, 24);
    const placeholders: MediaManifestEntry[] = [];
    for (let i = 0; i < numImages; i++) {
      const genInput: GenerationInput = {
        prompt: params.prompt ?? "",
        model: entry.endpoint,
        duration: IMAGE_DURATION_SECONDS,
        aspectRatio: params.aspectRatio ?? "",
        numImages,
        outputIndex: i,
        createdAt,
      };
      placeholders.push(
        createPlaceholderEntry({ id: newId(), type: "image", name: `${baseName} ${i + 1}`, duration: IMAGE_DURATION_SECONDS, ext: "png", genInput }),
      );
    }
    return placeholders;
  }

  // upscale: not reachable via the UI yet — entryUrl is unwired, same limit as upscale_media.
  return [];
}

export function GenerationPanel({ generation, newId, entries, onClose }: GenerationPanelProps) {
  const [kind, setKind] = useState<GenModelKind>("video");
  const [modelId, setModelId] = useState<string>(() => listGenModels("video")[0]!.id);

  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [aspectRatio, setAspectRatio] = useState<string | undefined>(undefined);
  const [resolution, setResolution] = useState<string | undefined>(undefined);
  const [voice, setVoice] = useState<string | undefined>(undefined);
  const [lyrics, setLyrics] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [numImages, setNumImages] = useState(1);
  const [upscaleMediaId, setUpscaleMediaId] = useState<string | undefined>(undefined);

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    generation
      .hasKey()
      .then((v) => { if (alive) setHasKey(v); })
      .catch(() => { if (alive) setHasKey(false); });
    return () => { alive = false; };
  }, [generation]);

  function resetControls() {
    setDuration(undefined);
    setAspectRatio(undefined);
    setResolution(undefined);
    setVoice(undefined);
    setLyrics("");
    setInstrumental(false);
    setNumImages(1);
    setUpscaleMediaId(undefined);
    setError(null);
    setStatus(null);
  }

  function handleKindChange(k: GenModelKind) {
    if (k === kind) return;
    setKind(k);
    setModelId(listGenModels(k)[0]?.id ?? "");
    resetControls();
  }

  function handleModelChange(id: string) {
    setModelId(id);
    resetControls();
  }

  const entry = genModel(modelId);

  const effAspect = aspectRatio ?? entry?.caps.aspectRatios?.[0];
  const effResolution = resolution ?? entry?.caps.resolutions?.[0];
  const effVoice = voice ?? entry?.caps.voices?.[0];

  const upscaleCandidates = useMemo(() => {
    if (!entry || entry.kind !== "upscale") return [];
    const inputs = entry.caps.upscaleInputs ?? [];
    return (entries?.() ?? []).filter((e) => (e.type === "video" || e.type === "image") && inputs.includes(e.type));
  }, [entry, entries]);

  const params: GenToolParams = useMemo(() => {
    if (!entry) return {};
    switch (entry.kind) {
      case "video":
        return { prompt, duration: duration ?? entry.caps.durations?.[0] ?? 5, aspectRatio: effAspect, resolution: effResolution };
      case "image":
        return { prompt, aspectRatio: effAspect, numImages };
      case "audio":
        return { prompt, voice: effVoice, lyrics: lyrics || undefined, instrumental, duration: duration ?? (entry.caps.supportsLyrics ? 60 : 10) };
      case "upscale": {
        const source = upscaleCandidates.find((e) => e.id === upscaleMediaId);
        const srcDuration = source ? (source.type === "image" ? 1 : source.duration) : 1;
        return { duration: srcDuration, resolution: effResolution };
      }
    }
  }, [entry, prompt, duration, effAspect, effResolution, effVoice, lyrics, instrumental, numImages, upscaleMediaId, upscaleCandidates]);

  const estimate = entry ? estimateCredits(entry, params) : 0;

  const hasRequiredText = kind === "audio" ? prompt.trim().length > 0 || lyrics.trim().length > 0 : prompt.trim().length > 0;
  const canSubmit = entry != null && kind !== "upscale" && hasKey === true && hasRequiredText && !busy;

  async function handleGenerate() {
    if (!entry || busy) return;
    setError(null);
    setStatus(null);

    const validationError = validateGenParams(entry, params);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    try {
      const input = entry.buildInput(params);
      const placeholders = buildPlaceholders(entry, params, newId);
      for (const p of placeholders) generation.addPlaceholder(p);
      const result = await generation.startJob({
        modelEndpoint: entry.endpoint,
        input,
        placeholders,
        model: entry.endpoint,
        costCredits: estimate,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPrompt("");
      setLyrics("");
      setStatus("Generation started — see the media library.");
    } finally {
      setBusy(false);
    }
  }

  const labelStyle = { fontSize: theme.fontSize.xxs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium };
  const mutedStyle = { fontSize: theme.fontSize.xxs, color: theme.text.muted, fontWeight: theme.fontWeight.regular };
  const fieldGap = { display: "flex", flexDirection: "column" as const, gap: theme.spacing.xxs };

  return (
    <div
      data-testid="generation-panel"
      style={{
        position: "fixed",
        inset: 0,
        background: theme.bg.scrim,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: theme.z.dialog,
      }}
    >
      <div
        style={{
          background: theme.bg.raised,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.md,
          padding: theme.spacing.lg,
          minWidth: theme.size.generationPanelMin,
          boxShadow: theme.shadow.lg,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.sm,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: theme.spacing.xxs, flex: 1 }}>
            {KIND_TABS.map(({ kind: k, label }) => (
              <button
                key={k}
                data-testid={`gen-kind-tab-${k}`}
                aria-pressed={kind === k}
                onClick={() => handleKindChange(k)}
                style={{
                  flex: 1,
                  background: kind === k ? theme.accent.primary : theme.bg.surface,
                  color: kind === k ? theme.text.onAccent : theme.text.secondary,
                  border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
                  borderRadius: theme.radius.xs,
                  padding: `${theme.spacing.xxs} 0`,
                  fontSize: theme.fontSize.xxs,
                  fontWeight: theme.fontWeight.semibold,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {onClose && (
            <button
              data-testid="gen-close"
              onClick={onClose}
              aria-label="Close"
              style={{ background: "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.fontSize.md, padding: 0, lineHeight: 1, marginLeft: theme.spacing.sm }}
            >
              ×
            </button>
          )}
        </div>

        <div style={fieldGap}>
          <span style={labelStyle}>Model</span>
          <Select
            testid="gen-model-select"
            value={modelId}
            options={listGenModels(kind).map((m) => ({ value: m.id, label: m.displayName }))}
            onChange={handleModelChange}
            disabled={kind === "upscale"}
          />
        </div>

        {kind === "upscale" ? (
          <>
            <div style={fieldGap}>
              <span style={labelStyle}>Media</span>
              <Select
                testid="gen-upscale-media-select"
                value={upscaleMediaId ?? null}
                placeholder="Select media…"
                options={upscaleCandidates.map((e) => ({ value: e.id, label: e.name }))}
                onChange={setUpscaleMediaId}
                disabled
              />
            </div>
            {entry && entry.caps.resolutions && (
              <div style={fieldGap}>
                <span style={labelStyle}>Resolution</span>
                <Select
                  testid="gen-resolution-select"
                  value={effResolution ?? null}
                  options={entry.caps.resolutions.map((r) => ({ value: r, label: r }))}
                  onChange={setResolution}
                  disabled
                />
              </div>
            )}
            <div data-testid="gen-upscale-note" style={mutedStyle}>
              Upscaling needs media upload, coming soon.
            </div>
          </>
        ) : (
          <>
            {entry && entry.caps.durations && (
              <div style={fieldGap}>
                <span style={labelStyle}>Duration</span>
                <Select
                  testid="gen-duration-select"
                  value={String(duration ?? entry.caps.durations[0])}
                  options={entry.caps.durations.map((d) => ({ value: String(d), label: `${d}s` }))}
                  onChange={(v) => setDuration(Number(v))}
                />
              </div>
            )}
            {entry && entry.caps.aspectRatios && (
              <div style={fieldGap}>
                <span style={labelStyle}>Aspect ratio</span>
                <Select
                  testid="gen-aspect-select"
                  value={effAspect ?? null}
                  options={entry.caps.aspectRatios.map((a) => ({ value: a, label: a }))}
                  onChange={setAspectRatio}
                />
              </div>
            )}
            {entry && entry.caps.resolutions && (
              <div style={fieldGap}>
                <span style={labelStyle}>Resolution</span>
                <Select
                  testid="gen-resolution-select"
                  value={effResolution ?? null}
                  options={entry.caps.resolutions.map((r) => ({ value: r, label: r }))}
                  onChange={setResolution}
                />
              </div>
            )}
            {entry && entry.caps.voices && (
              <div style={fieldGap}>
                <span style={labelStyle}>Voice</span>
                <Select
                  testid="gen-voice-select"
                  value={effVoice ?? null}
                  options={entry.caps.voices.map((v) => ({ value: v, label: v }))}
                  onChange={setVoice}
                />
              </div>
            )}
            {entry && entry.caps.numImagesMax !== undefined && (
              <div style={fieldGap}>
                <span style={labelStyle}>Images</span>
                <input
                  data-testid="gen-num-images"
                  type="number"
                  min={1}
                  max={entry.caps.numImagesMax}
                  value={numImages}
                  onChange={(e) => setNumImages(Math.max(1, Math.min(entry?.caps.numImagesMax ?? 4, Number(e.target.value) || 1)))}
                  style={{
                    background: theme.bg.surface,
                    border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
                    borderRadius: theme.radius.xs,
                    color: theme.text.primary,
                    fontSize: theme.fontSize.xs,
                    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                    width: "100%",
                  }}
                />
              </div>
            )}

            <textarea
              data-testid="gen-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              placeholder={PROMPT_PLACEHOLDER[kind]}
              rows={3}
              style={{
                resize: "vertical",
                background: theme.bg.surface,
                border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
                borderRadius: theme.radius.sm,
                color: theme.text.primary,
                fontSize: theme.fontSize.sm,
                fontWeight: theme.fontWeight.regular,
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                outline: "none",
                fontFamily: "inherit",
              }}
            />

            {entry?.caps.supportsLyrics && (
              <>
                <textarea
                  data-testid="gen-lyrics"
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  disabled={busy}
                  placeholder="Lyrics (optional)…"
                  rows={3}
                  style={{
                    resize: "vertical",
                    background: theme.bg.surface,
                    border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
                    borderRadius: theme.radius.sm,
                    color: theme.text.primary,
                    fontSize: theme.fontSize.sm,
                    fontWeight: theme.fontWeight.regular,
                    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: theme.spacing.xxs, fontSize: theme.fontSize.xs, color: theme.text.secondary }}>
                  <input
                    data-testid="gen-instrumental"
                    type="checkbox"
                    checked={instrumental}
                    onChange={(e) => setInstrumental(e.target.checked)}
                  />
                  Instrumental
                </label>
              </>
            )}

            <div data-testid="gen-references-hint" style={mutedStyle}>
              Reference media: coming soon.
            </div>
          </>
        )}

        {entry && (
          <div data-testid="gen-cost" style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium }}>
            Estimated cost: {formatCredits(estimate)}
          </div>
        )}

        {hasKey === false && kind !== "upscale" && (
          <div data-testid="gen-key-hint" style={mutedStyle}>
            Set your fal.ai key in Settings to generate.
          </div>
        )}

        {error != null && (
          <div
            data-testid="gen-error"
            style={{
              fontSize: theme.fontSize.xs,
              color: theme.status.error,
              fontWeight: theme.fontWeight.regular,
              background: theme.bg.surface,
              border: `${theme.borderWidth.hairline} solid ${theme.status.error}`,
              borderRadius: theme.radius.xs,
              padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            }}
          >
            {error}
          </div>
        )}

        {status != null && (
          <div data-testid="gen-status" style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, fontWeight: theme.fontWeight.regular }}>
            {status}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            data-testid="gen-submit"
            disabled={!canSubmit}
            onClick={handleGenerate}
            style={{
              background: theme.accent.primary,
              border: "none",
              borderRadius: theme.radius.xs,
              color: theme.text.onAccent,
              cursor: !canSubmit ? "not-allowed" : "pointer",
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.medium,
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              opacity: !canSubmit ? theme.opacity.disabled : theme.opacity.opaque,
            }}
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
