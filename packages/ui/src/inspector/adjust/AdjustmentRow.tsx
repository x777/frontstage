import { AdjustSlider } from "./AdjustSlider.js";
import { ScrubbableNumberField } from "./ScrubbableNumberField.js";
import { theme } from "../../theme/theme.js";

export interface AdjustmentRowProps {
  label: string;
  value: number | null;
  min: number;
  max: number;
  def: number;
  gradient?: "temperature" | "tint" | "luma" | "none";
  onChange: (v: number) => void;
  onCommit: () => void;
  format: (v: number) => string;
}

export function AdjustmentRow({
  label,
  value,
  min,
  max,
  def,
  gradient,
  onChange,
  onCommit,
  format,
}: AdjustmentRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xxs} 0`,
      }}
      data-testid={`adjustment-row-${label}`}
    >
      <span
        style={{
          fontSize: theme.fontSize.xs,
          color: theme.text.secondary,
          minWidth: theme.size.inspectorLabel,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <AdjustSlider
        value={value}
        min={min}
        max={max}
        def={def}
        gradient={gradient}
        onChange={onChange}
        onCommit={onCommit}
      />
      <ScrubbableNumberField
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        onCommit={onCommit}
        format={format}
      />
    </div>
  );
}

// lowercase alias matching the spec name
export { AdjustmentRow as adjustmentRow };
