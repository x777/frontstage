import { Toast } from "@frontstage/ui";

export const Message = () => (
  <div style={{ background: "var(--bg-base)", width: 420, height: 120, position: "relative" }}>
    <Toast message="Skill exported to ~/.claude/skills" />
  </div>
);
