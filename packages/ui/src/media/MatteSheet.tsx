import { useState } from "react";
import { matteName, matteSize } from "@palmier/core";
import type { MatteAspect } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { Dialog } from "../primitives/Dialog.js";
import { Button } from "../primitives/Button.js";
import { Select } from "../primitives/Select.js";
import { TextInput } from "../primitives/TextInput.js";
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

// Row language mirrors MatteSheet.swift's `row(icon:label:control:)`: label left, control pinned
// to the fixed control column (matteControlW, trailing-aligned in Swift).
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: theme.spacing.smMd };
const labelStyle: React.CSSProperties = {
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.text.primary,
  flex: 1,
};
const controlStyle: React.CSSProperties = { width: theme.size.matteControlW, flexShrink: 0 };

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
    <Dialog
      onClose={onClose}
      width={theme.size.matteSheetW}
      footer={
        <>
          <Button variant="default" onClick={onClose} testid="matte-sheet-cancel">
            Cancel
          </Button>
          <Button variant="accent" shape="rect" disabled={isCreating} onClick={handleCreate} testid="matte-sheet-create">
            {isCreating ? "Creating…" : "Create Matte"}
          </Button>
        </>
      }
    >
      {/* Own testid (not Dialog's -panel suffix) — preserves the sheet's pre-existing contract. */}
      <div data-testid="matte-sheet" style={{ display: "flex", flexDirection: "column", gap: theme.spacing.lg }}>
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
          <div style={{ ...controlStyle, display: "flex", alignItems: "center", gap: theme.spacing.xs }}>
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
            <TextInput testid="matte-color-input" value={hex} onChange={setHex} style={{ flex: 1, minWidth: 0 }} />
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Aspect</span>
          <div style={controlStyle}>
            <Select testid="matte-aspect-select" value={aspect} options={ASPECT_OPTIONS} onChange={setAspect} />
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Size</span>
          <span
            data-testid="matte-size-readout"
            style={{ ...controlStyle, textAlign: "right", fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.text.tertiary }}
          >
            {width} × {height}
          </span>
        </div>

        {error != null && (
          <span data-testid="matte-sheet-error" style={{ fontSize: theme.fontSize.xs, color: theme.status.error }}>
            {error}
          </span>
        )}
      </div>
    </Dialog>
  );
}
