import { useState } from "react";
import type { MediaManifestEntry } from "@palmier/core";
import type { ImageGenInput, ModelEntry } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { ModelPicker } from "./ModelPicker.js";

export interface GenerationPanelProps {
  generate: (input: ImageGenInput) => Promise<MediaManifestEntry>;
  model?: string;
  onClose?: () => void;
  imageModels?: ModelEntry[];
  imageModel?: string;
  onImageModelChange?: (id: string) => void;
}

export function GenerationPanel({ generate, model, onClose, imageModels, imageModel, onImageModelChange }: GenerationPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setStatus("Generating…");
    try {
      const entry = await generate({ prompt });
      setStatus("Generated: " + entry.name);
      setPrompt("");
    } catch (e) {
      setError(String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: theme.spacing.xxs,
          }}
        >
          <span
            style={{
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.semibold,
              color: theme.text.primary,
            }}
          >
            Generate Image
          </span>
          {onClose && (
            <button
              data-testid="gen-close"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: theme.text.muted,
                cursor: "pointer",
                fontSize: theme.fontSize.md,
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>

        {(imageModels && imageModel && onImageModelChange) ? (
          <ModelPicker testid="gen-model-picker" models={imageModels} value={imageModel} onChange={onImageModelChange} />
        ) : model != null ? (
          <div
            data-testid="gen-model"
            style={{ fontSize: theme.fontSize.xxs, color: theme.text.muted, fontWeight: theme.fontWeight.regular }}
          >
            {model}
          </div>
        ) : null}

        <textarea
          data-testid="gen-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
          placeholder="Describe the image…"
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

        {(status != null) && (
          <div
            data-testid="gen-status"
            style={{
              fontSize: theme.fontSize.xs,
              color: busy ? theme.text.muted : theme.text.secondary,
              fontWeight: theme.fontWeight.regular,
            }}
          >
            {status}
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

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            data-testid="gen-submit"
            disabled={!prompt.trim() || busy}
            onClick={handleGenerate}
            style={{
              background: theme.accent.primary,
              border: "none",
              borderRadius: theme.radius.xs,
              color: theme.text.onAccent,
              cursor: !prompt.trim() || busy ? "not-allowed" : "pointer",
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.medium,
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              opacity: !prompt.trim() || busy ? theme.opacity.disabled : theme.opacity.opaque,
            }}
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
