import { theme } from "../theme/theme.js";

export function PanelHeader(props: {
  title: string;
  trailing?: React.ReactNode;
  testid?: string;
}) {
  const { title, trailing, testid } = props;
  return (
    <div
      data-testid={testid}
      style={{
        height: theme.size.panelHeader,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: theme.bg.raised,
        borderBottom: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
        padding: `0 ${theme.spacing.sm}`,
      }}
    >
      <span
        style={{
          fontSize: theme.fontSize.xs,
          fontWeight: theme.fontWeight.semibold,
          color: theme.text.secondary,
        }}
      >
        {title}
      </span>
      {trailing}
    </div>
  );
}
