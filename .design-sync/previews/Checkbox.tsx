import { Checkbox } from "@palmier/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", padding: 16, display: "flex", flexDirection: "column", gap: 10 };

export const States = () => (
  <div style={dark}>
    <Checkbox checked={false} onChange={() => {}} label="Instrumental" />
    <Checkbox checked onChange={() => {}} label="Enabled" />
    <Checkbox checked disabled onChange={() => {}} label="Locked setting" />
  </div>
);
