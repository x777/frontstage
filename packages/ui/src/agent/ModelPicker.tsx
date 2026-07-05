import type { ModelEntry } from "@frontstage/ai";
import { theme } from "../theme/theme.js";
import { Select } from "../primitives/index.js";

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
        <span style={{ fontSize: theme.fontSize.sm, color: theme.text.primary, fontWeight: theme.fontWeight.medium }}>
          {label}
        </span>
      )}
      <Select
        testid={testid ?? "model-picker"}
        value={value}
        options={models.map((m) => ({ value: m.id, label: m.label }))}
        onChange={onChange}
      />
    </div>
  );
}
