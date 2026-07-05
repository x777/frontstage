import { useEffect, useMemo, useState } from "react";
import type { GenerationInput, MediaManifestEntry } from "@frontstage/core";
import { createPlaceholderEntry } from "@frontstage/core";
import type { GenModelEntry, GenModelKind, GenToolParams, StartJobArgs } from "@frontstage/ai";
import { genModel, listGenModels, validateGenParams, estimateCredits, formatCredits } from "@frontstage/ai";
import { theme } from "../theme/theme.js";
import { Select, Button, IconButton, Icon, SegmentedTabs, TextInput, Checkbox } from "../primitives/index.js";
import { isMediaDrag, readMediaDragPayload } from "../media/FolderTile.js";

const IMAGE_DURATION_SECONDS = 5; // mirrors generate-image-tool.ts

// No per-model cap declared today (M14C T3) -> this generic ceiling applies, mirroring Swift's
// supportsReferences gate (hidden only when a model explicitly declares zero references).
const DEFAULT_MAX_REFERENCES = 4;

const KIND_TABS: { kind: GenModelKind; label: string }[] = [
  { kind: "video", label: "Video" },
  { kind: "image", label: "Image" },
  { kind: "audio", label: "Audio" },
  { kind: "upscale", label: "Upscale" },
];

// SegmentedTabs takes generic {id, label} segments — same 4 kinds, same testids (kit derives
// `${testid}-${id}`), just the shared segmented-control chrome instead of a bespoke tab row.
const KIND_SEGMENTS = KIND_TABS.map(({ kind, label }) => ({ id: kind, label }));

// GenerationView's submitButton and AgentInputBox.sendStopButton (M16E T1) are the SAME Swift
// affordance — a circular, solid-accent "arrow.up" button. Reusing T1's exact icon-in-capsule
// pattern here rather than a rect CTA (see m16e-task-2-report.md for the Swift citation).
const SUBMIT_ICON_SIZE = 14;
const CLOSE_ICON_SIZE = 14;
const TILE_ICON_SIZE = 20;
const TILE_REMOVE_ICON_SIZE = 10;
const EMPTY_TILE_ICON_SIZE = 16;

const PROMPT_PLACEHOLDER: Record<GenModelKind, string> = {
  video: "Describe the video…",
  image: "Describe the image…",
  audio: "Text to speak, or a style description…",
  upscale: "",
  transcribe: "", // no tab for this kind yet — the Captions tab (M11D) owns transcription UI
};

// The exact ToolContext["generation"] shape — the manual panel submits through the same facade the tools use.
export interface GenerationFacade {
  hasKey(): Promise<boolean>;
  addPlaceholder(entry: MediaManifestEntry): void;
  startJob(args: StartJobArgs): Promise<{ jobId: string } | { error: string }>;
  entryUrl?(mediaRef: string): Promise<string | undefined>;
  confirmThreshold: number;
  // generate_audio's video-to-audio span source (M14C T3) — unused by this panel (no span UI
  // here yet), declared so both hosts' ONE facade object satisfies this type without excess-
  // property errors.
  renderSpanToMp4?(startFrame: number, frameCount: number, shortSide: number): Promise<Uint8Array>;
  uploadFile?(bytes: Uint8Array, contentType: string, fileName: string): Promise<string>;
}

export interface GenerationPanelProps {
  generation: GenerationFacade;
  newId: () => string;
  entries?: () => MediaManifestEntry[];
  onClose?: () => void;
}

// Builds the full-sentinel GenerationInput placeholder(s) the SAME way generate-tools.ts does —
// only called after validateGenParams already passed, so params are known-valid here.
// referenceIds (M14C T3) records which library assets fed params.imageUrls, mirroring Swift's
// genInput.imageURLAssetIds — video/image kinds only, ignored (no references UI) for the rest.
function buildPlaceholders(entry: GenModelEntry, params: GenToolParams, newId: () => string, referenceIds: string[] = []): MediaManifestEntry[] {
  const createdAt = new Date().toISOString();

  if (entry.kind === "video") {
    const duration = params.duration ?? entry.caps.durations?.[0] ?? 5;
    const genInput: GenerationInput = {
      prompt: params.prompt ?? "",
      model: entry.endpoint,
      duration,
      aspectRatio: params.aspectRatio ?? "",
      resolution: params.resolution,
      imageURLAssetIds: referenceIds.length > 0 ? referenceIds : undefined,
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
        imageURLAssetIds: referenceIds.length > 0 ? referenceIds : undefined,
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
  const [references, setReferences] = useState<MediaManifestEntry[]>([]);
  const [referencesTargeted, setReferencesTargeted] = useState(false);
  const [referencesNote, setReferencesNote] = useState<string | null>(null);
  // Style-only: mirrors promptArea's isPromptFocused border highlight (GenerationView.swift).
  const [promptFocused, setPromptFocused] = useState(false);
  const [lyricsFocused, setLyricsFocused] = useState(false);

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
    // References are cleared on a TAB switch only, not on a model change within the same tab —
    // mirrors Swift's clearReferences() call site (GenerationView's selectedType onChange).
    setReferences([]);
    setReferencesNote(null);
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

  // References strip (M14C T3, the M10D deferral): image + video tabs only, mirroring Swift's
  // DropZoneView/supportsReferences gate — hidden only when a model explicitly declares zero.
  const referenceCap = entry?.caps.maxReferenceImages ?? DEFAULT_MAX_REFERENCES;
  const showReferences = entry != null && (kind === "image" || kind === "video") && referenceCap > 0;

  function handleReferenceDrop(e: React.DragEvent) {
    setReferencesTargeted(false);
    const payload = readMediaDragPayload(e);
    if (!payload || payload.kind !== "asset") return;
    e.preventDefault();
    const asset = entries?.().find((en) => en.id === payload.id);
    // Image-type entries only — Swift's dropZone(accepting:) zone filter.
    if (!asset || asset.type !== "image") return;
    if (references.some((r) => r.id === asset.id)) return;
    setReferences((prev) => [...prev, asset]);
  }

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
      case "transcribe":
        // not reachable via this panel yet — no KIND_TABS entry (M11D's Captions tab owns this)
        return {};
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
      // References resolve to URLs at submit (M14C T3) — capped to referenceCap, over-cap trims
      // with a note (Swift's "trim or disable"). buildInput/buildPlaceholders never mutate the
      // memoized params directly; a resolved copy carries imageUrls when references were used.
      let resolvedParams = params;
      let referenceIds: string[] = [];
      if (showReferences && references.length > 0 && generation.entryUrl) {
        const capped = references.slice(0, referenceCap);
        setReferencesNote(capped.length < references.length ? `Only the first ${referenceCap} reference(s) were used.` : null);
        const urls: string[] = [];
        const ids: string[] = [];
        for (const ref of capped) {
          const url = await generation.entryUrl(ref.id);
          if (url) { urls.push(url); ids.push(ref.id); }
        }
        if (urls.length > 0) {
          resolvedParams = { ...params, imageUrls: urls };
          referenceIds = ids;
        }
      }

      const input = entry.buildInput(resolvedParams);
      const placeholders = buildPlaceholders(entry, resolvedParams, newId, referenceIds);
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
      setReferences([]);
      setStatus("Generation started — see the media library.");
    } finally {
      setBusy(false);
    }
  }

  // Canonical row language (M16D, inspector/fields.tsx labelStyle / GenerationView's row labels): sm/medium/primary.
  const labelStyle = { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.text.primary };
  const mutedStyle = { fontSize: theme.fontSize.xs, color: theme.text.muted, fontWeight: theme.fontWeight.regular };
  const fieldGap = { display: "flex", flexDirection: "column" as const, gap: theme.spacing.xs };

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
          // GenerationView's bodyContent: aiGradientDark fill AND stroke (the same gradient on
          // both layers) — the CSS padding-box/border-box trick reproduces that double-use.
          background: `${theme.gradients.aiDark} padding-box, ${theme.gradients.aiDark} border-box`,
          border: `${theme.borderWidth.medium} solid transparent`,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          minWidth: theme.size.generationPanelMin,
          boxShadow: theme.shadow.lg,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.sm,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.sm }}>
          <SegmentedTabs
            testid="gen-kind-tab"
            segments={KIND_SEGMENTS}
            active={kind}
            onSelect={(id) => handleKindChange(id as GenModelKind)}
          />
          {onClose && (
            <IconButton testid="gen-close" onClick={onClose} title="Close" frame="smMd">
              <Icon name="x" size={CLOSE_ICON_SIZE} />
            </IconButton>
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
                <TextInput
                  testid="gen-num-images"
                  type="number"
                  min={1}
                  max={entry.caps.numImagesMax}
                  value={String(numImages)}
                  onChange={(v) => setNumImages(Math.max(1, Math.min(entry?.caps.numImagesMax ?? 4, Number(v) || 1)))}
                />
              </div>
            )}

            <textarea
              data-testid="gen-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setPromptFocused(true)}
              onBlur={() => setPromptFocused(false)}
              disabled={busy}
              placeholder={PROMPT_PLACEHOLDER[kind]}
              rows={3}
              style={{
                resize: "vertical",
                background: theme.bg.raised,
                borderWidth: theme.borderWidth.thin,
                borderStyle: "solid",
                borderColor: promptFocused ? theme.accent.primary : theme.border.primary,
                borderRadius: theme.radius.xsSm,
                color: theme.text.primary,
                fontSize: theme.fontSize.sm,
                fontWeight: theme.fontWeight.regular,
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                minHeight: theme.size.genPromptMinH,
                outline: "none",
                fontFamily: "inherit",
                transition: `border-color ${theme.anim.hover} ease-out`,
              }}
            />

            {entry?.caps.supportsLyrics && (
              <>
                <textarea
                  data-testid="gen-lyrics"
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  onFocus={() => setLyricsFocused(true)}
                  onBlur={() => setLyricsFocused(false)}
                  disabled={busy}
                  placeholder="Lyrics (optional)…"
                  rows={3}
                  style={{
                    resize: "vertical",
                    background: theme.bg.raised,
                    borderWidth: theme.borderWidth.thin,
                    borderStyle: "solid",
                    borderColor: lyricsFocused ? theme.accent.primary : theme.border.primary,
                    borderRadius: theme.radius.xsSm,
                    color: theme.text.primary,
                    fontSize: theme.fontSize.sm,
                    fontWeight: theme.fontWeight.regular,
                    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                    outline: "none",
                    fontFamily: "inherit",
                    transition: `border-color ${theme.anim.hover} ease-out`,
                  }}
                />
                <Checkbox
                  testid="gen-instrumental"
                  checked={instrumental}
                  onChange={setInstrumental}
                  label="Instrumental"
                />
              </>
            )}

            {showReferences ? (
              <div style={fieldGap}>
                <span style={labelStyle}>References</span>
                <div
                  data-testid="gen-references-zone"
                  onDragOver={(e) => { if (isMediaDrag(e)) { e.preventDefault(); setReferencesTargeted(true); } }}
                  onDragLeave={() => setReferencesTargeted(false)}
                  onDrop={handleReferenceDrop}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: theme.spacing.xs,
                    padding: theme.spacing.xs,
                    borderRadius: theme.radius.sm,
                    border: `${theme.borderWidth.thin} dashed ${referencesTargeted ? theme.accent.primary : theme.border.subtle}`,
                    background: referencesTargeted ? theme.bg.surface : "transparent",
                  }}
                >
                  {references.length === 0 && (
                    // Swift's dropZone add-tile: an icon centered in a fixed-size (referenceTileWidth
                    // × referenceTileHeight) placeholder, no caption text.
                    <div
                      data-testid="gen-references-empty"
                      title="Drop image references here"
                      style={{
                        width: theme.size.genRefTileW,
                        height: theme.size.genRefTileH,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: theme.text.muted,
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="plus" size={EMPTY_TILE_ICON_SIZE} />
                    </div>
                  )}
                  {references.map((ref) => (
                    <div
                      key={ref.id}
                      data-testid={`gen-reference-${ref.id}`}
                      title={ref.name}
                      style={{
                        position: "relative",
                        width: theme.size.genRefTileW,
                        height: theme.size.genRefTileH,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: theme.bg.raised,
                        border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
                        borderRadius: theme.radius.sm,
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ color: theme.text.muted, display: "flex" }}>
                        <Icon name="image" size={TILE_ICON_SIZE} />
                      </span>
                      <button
                        type="button"
                        data-testid={`gen-reference-remove-${ref.id}`}
                        aria-label={`Remove ${ref.name}`}
                        onClick={() => setReferences((prev) => prev.filter((r) => r.id !== ref.id))}
                        style={{
                          position: "absolute",
                          top: theme.spacing.xxs,
                          right: theme.spacing.xxs,
                          width: theme.iconSize.xs,
                          height: theme.iconSize.xs,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: `rgba(0, 0, 0, ${theme.opacity.strong})`,
                          border: "none",
                          borderRadius: theme.radius.pill,
                          color: theme.text.primary,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <Icon name="x" size={TILE_REMOVE_ICON_SIZE} />
                      </button>
                    </div>
                  ))}
                </div>
                {referencesNote && (
                  <div data-testid="gen-references-note" style={mutedStyle}>{referencesNote}</div>
                )}
              </div>
            ) : entry && (kind === "image" || kind === "video") ? (
              <div data-testid="gen-references-unsupported" style={mutedStyle}>
                References: not supported by {entry.displayName}.
              </div>
            ) : (
              kind === "audio" && (
                <div data-testid="gen-references-hint" style={mutedStyle}>
                  Reference media: coming soon.
                </div>
              )
            )}
          </>
        )}

        {entry && (
          <div
            data-testid="gen-cost"
            title="Estimated cost. Actual billing may differ slightly."
            style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium }}
          >
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
          {/* Solid accent, circular — GenerationView.submitButton (.tint(Accent.primary)), NOT
              the aiGradient (that belongs to the agent composer's shimmer text, not this CTA).
              Same family as MentionInput's "agent-send" (M16E T1). */}
          <Button
            testid="gen-submit"
            variant="accent"
            shape="capsule"
            disabled={!canSubmit}
            onClick={handleGenerate}
            title="Generate"
            style={{
              width: theme.iconSize.xl,
              height: theme.iconSize.xl,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="send" size={SUBMIT_ICON_SIZE} />
          </Button>
        </div>
      </div>
    </div>
  );
}
