import { theme } from "../theme/theme.js";

export function Toast(props: { message: string; testid?: string }) {
  const { message, testid } = props;

  return (
    <div
      data-testid={testid}
      style={{
        position: "fixed",
        bottom: theme.spacing.lg,
        left: "50%",
        transform: "translateX(-50%)",
        background: theme.bg.prominent,
        borderRadius: theme.radius.sm,
        boxShadow: theme.shadow.md,
        fontSize: theme.fontSize.sm,
        color: theme.text.secondary,
        padding: `${theme.spacing.xs} ${theme.spacing.md}`,
        zIndex: theme.z.toast,
        maxWidth: theme.size.skillsToastMax,
      }}
    >
      {message}
    </div>
  );
}
