import { theme } from "../theme/theme.js";

export function Dialog(props: {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: string;
  testid?: string;
}) {
  const { title, children, footer, onClose, width, testid } = props;

  return (
    <div
      data-testid={testid ? `${testid}-scrim` : undefined}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: theme.bg.scrim,
        zIndex: theme.z.dialog,
      }}
    >
      <div
        data-testid={testid ? `${testid}-panel` : undefined}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.bg.raised,
          borderRadius: theme.radius.mdLg,
          boxShadow: theme.shadow.lg,
          padding: theme.spacing.lg,
          minWidth: theme.size.dialogMin,
          width,
        }}
      >
        {title && (
          <div
            style={{
              fontSize: theme.fontSize.md,
              fontWeight: theme.fontWeight.semibold,
              color: theme.text.primary,
              marginBottom: theme.spacing.sm,
            }}
          >
            {title}
          </div>
        )}
        {children}
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: theme.spacing.xs,
              marginTop: theme.spacing.sm,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
