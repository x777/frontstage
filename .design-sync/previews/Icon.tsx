import { Icon } from "@frontstage/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", color: "var(--text-secondary)", padding: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" };

export const Glyphs = () => (
  <div style={dark}>
    <Icon name="folder" size={18} />
    <Icon name="search" size={18} />
    <Icon name="plus" size={18} />
    <Icon name="sparkles" size={18} />
    <Icon name="captions" size={18} />
    <Icon name="scissors" size={18} />
    <Icon name="undo" size={18} />
    <Icon name="redo" size={18} />
    <Icon name="book" size={18} />
    <Icon name="trash" size={18} />
    <Icon name="x" size={18} />
    <Icon name="ellipsis" size={18} />
  </div>
);

export const Transport = () => (
  <div style={{ ...dark, color: "var(--text-primary)" }}>
    <Icon name="skip-to-start" size={16} />
    <Icon name="step-back" size={16} />
    <Icon name="play" size={16} />
    <Icon name="pause" size={16} />
    <Icon name="step-forward" size={16} />
    <Icon name="skip-to-end" size={16} />
  </div>
);

export const Sizes = () => (
  <div style={dark}>
    <Icon name="sparkles" size={12} />
    <Icon name="sparkles" size={16} />
    <Icon name="sparkles" size={22} />
    <Icon name="sparkles" size={28} />
  </div>
);
