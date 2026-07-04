import { useState } from "react";
import { matteName, matteSize } from "@palmier/core";
import type { MatteAspect } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { Select } from "../primitives/Select.js";
import { renderMattePng } from "./matte-render.js";

const ASPECT_OPTIONS: readonly { value: MatteAspect; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "9:14", label: "9:14" },
  { value: "2.4:1", label: "2.4:1" },
];

// Duck-typed to the one MediaLibrary method the sheet needs — the SAME fromBytes-backed flow
// import_media uses, called directly (not through the agent tool executor).
export interface MatteSheetLibrary {
  importBytes(bytes: Uint8Array, mimeType: string, name?: string, folderId?: string): Promise<{ assetId: string }>;
}

export interface MatteSheetProps {
  library: MatteSheetLibrary;
  timelineWidth: number;
  timelineHeight: number;
  folderId?: string;
  onClose: () => void;
  onCreated?: (assetId: string) => void;
}

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: theme.spacing.smMd };
const labelStyle: React.CSSProperties = {
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.text.primary,
  minWidth: theme.size.inspectorLabel,
  flexShrink: 0,
};
const inputStyle: React.CSSProperties = {
  background: theme.bg.raised,
  color: theme.text.primary,
  border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
  borderRadius: theme.radius.xs,
  padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
  fontSize: theme.fontSize.xs,
  outline: "none",
  flex: 1,
  minWidth: 0,
  boxSizing: "border-box",
};

export function MatteSheet({ library, timelineWidth, timelineHeight, folderId, onClose, onCreated }: MatteSheetProps) {
  const [hex, setHex] = useState("#000000");
  const [aspect, setAspect] = useState<MatteAspect>("project");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { width, height } = matteSize(aspect, timelineWidth, timelineHeight);

  async function handleCreate() {
    if (isCreating) return;
    setError(null);
    setIsCreating(true);
    try {
      const bytes = await renderMattePng(hex, width, height);
      const name = matteName(aspect, width, height);
      const { assetId } = await library.importBytes(bytes, "image/png", name, folderId);
      onCreated?.(assetId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div
      data-testid="matte-sheet-overlay"
      onClick={onClose}
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
        data-testid="matte-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.bg.raised,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.md,
          padding: theme.spacing.lgXl,
          minWidth: theme.size.settingsPanelMin,
          boxShadow: theme.shadow.lg,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.lg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
            New Matte
          </span>
          <button
            data-testid="matte-sheet-close"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.fontSize.md, padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Color</span>
          <span
            data-testid="matte-color-swatch"
            style={{
              width: theme.size.colorSwatch,
              height: theme.size.colorSwatch,
              flexShrink: 0,
              borderRadius: theme.radius.xs,
              background: hex,
              border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
            }}
          />
          <input data-testid="matte-color-input" type="text" value={hex} onChange={(e) => setHex(e.target.value)} style={inputStyle} />
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Aspect</span>
          <div style={{ flex: 1 }}>
            <Select testid="matte-aspect-select" value={aspect} options={ASPECT_OPTIONS} onChange={setAspect} />
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Size</span>
          <span
            data-testid="matte-size-readout"
            style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.text.tertiary }}
          >
            {width} × {height}
          </span>
        </div>

        {error != null && (
          <span data-testid="matte-sheet-error" style={{ fontSize: theme.fontSize.xs, color: theme.status.error }}>
            {error}
          </span>
        )}

        <button
          data-testid="matte-sheet-create"
          disabled={isCreating}
          onClick={handleCreate}
          style={{
            background: theme.accent.primary,
            border: "none",
            borderRadius: theme.radius.sm,
            color: theme.text.onAccent,
            cursor: isCreating ? "not-allowed" : "pointer",
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.semibold,
            padding: `${theme.spacing.smMd} 0`,
            opacity: isCreating ? theme.opacity.disabled : theme.opacity.opaque,
          }}
        >
          {isCreating ? "Creating…" : "Create Matte"}
        </button>
      </div>
    </div>
  );
}
