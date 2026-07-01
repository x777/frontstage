import { theme } from "../../theme/theme.js";

export interface SelectProps<T extends string> {
  value: T | null;
  options: readonly { value: T; label: string }[];
  placeholder?: string;
  onChange: (v: T) => void;
}

export function Select<T extends string>({ value, options, placeholder, onChange }: SelectProps<T>) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "") onChange(v as T);
      }}
      style={{
        background: theme.bg.raised,
        color: theme.text.primary,
        border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
        borderRadius: theme.radius.xs,
        fontSize: theme.fontSize.xs,
        padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
        width: "100%",
        cursor: "pointer",
      }}
    >
      {value === null && (
        <option value="" disabled>
          {placeholder ?? "—"}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
