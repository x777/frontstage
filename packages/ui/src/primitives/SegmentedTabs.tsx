import { theme } from "../theme/theme.js";
import { useHover } from "./use-hover.js";

function Segment(props: { id: string; label: string; active: boolean; onSelect: (id: string) => void; testid?: string }) {
  const { id, label, active, onSelect, testid } = props;
  const { hovered, hoverProps } = useHover();

  return (
    <button
      type="button"
      data-testid={testid}
      onClick={() => onSelect(id)}
      {...hoverProps}
      style={{
        background: active ? theme.bg.prominent : "transparent",
        color: active ? theme.text.primary : hovered ? theme.text.secondary : theme.text.tertiary,
        border: "none",
        borderRadius: theme.radius.xs,
        fontSize: theme.fontSize.xs,
        fontWeight: theme.fontWeight.medium,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        transition: `background ${theme.anim.hover} ease-out, color ${theme.anim.hover} ease-out`,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function SegmentedTabs(props: {
  segments: readonly { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  testid?: string;
}) {
  const { segments, active, onSelect, testid } = props;
  return (
    <div
      style={{
        display: "flex",
        background: theme.bg.raised,
        borderRadius: theme.radius.sm,
        padding: theme.spacing.xxs,
        gap: theme.spacing.xxs,
      }}
    >
      {segments.map((seg) => (
        <Segment
          key={seg.id}
          id={seg.id}
          label={seg.label}
          active={seg.id === active}
          onSelect={onSelect}
          testid={testid ? `${testid}-${seg.id}` : undefined}
        />
      ))}
    </div>
  );
}
