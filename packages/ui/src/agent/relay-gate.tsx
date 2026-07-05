import { theme } from "../theme/theme.js";
import { Button } from "../primitives/index.js";

// Shared login-gate contract (M18C T3) — GenerationPanel and AgentPanel both take this instead of
// duplicating relay-mode plumbing; signedIn comes from the same fetchMe() state as the top bar.
export interface RelayGate {
  signedIn: boolean;
  onSignIn: (provider: "google" | "github") => void;
}

// Terse "sign in to use this" row — same two-provider shape as SettingsPanel's signed-out pane,
// shrunk to fit inline above/in place of the gated control.
export function RelayGateRow({ copy, onSignIn, testid }: { copy: string; onSignIn: (provider: "google" | "github") => void; testid: string }) {
  return (
    <div data-testid={testid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.sm, flexWrap: "wrap" }}>
      <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontWeight: theme.fontWeight.regular }}>{copy}</span>
      <div style={{ display: "flex", gap: theme.spacing.xs, flexShrink: 0 }}>
        <Button testid={`${testid}-google`} size="small" onClick={() => onSignIn("google")}>Google</Button>
        <Button testid={`${testid}-github`} size="small" onClick={() => onSignIn("github")}>GitHub</Button>
      </div>
    </div>
  );
}
