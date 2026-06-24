import type { ModelEntry } from "@palmier/ai";
import { theme } from "../theme/theme.js";

export interface ModelPickerProps {
  models: ModelEntry[];
  value: string;
  onChange: (id: string) => void;
  testid?: string;
  label?: string;
}

export function ModelPicker({ models, value, onChange, testid, label }: ModelPickerProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
      {label && (
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium }}>
          {label}
        </span>
      )}
      <select
        data-testid={testid ?? "model-picker"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: theme.bg.surface,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.xs,
          color: theme.text.primary,
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.regular,
          padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
          cursor: "pointer",
          width: "100%",
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}
