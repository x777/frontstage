import { Icon, IconButton } from "@palmier/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", padding: 16, display: "flex", gap: 8, alignItems: "center" };

export const Basic = () => (
  <div style={dark}>
    <IconButton title="Search"><Icon name="search" size={14} /></IconButton>
    <IconButton title="Add"><Icon name="plus" size={14} /></IconButton>
    <IconButton title="More"><Icon name="ellipsis" size={14} /></IconButton>
    <IconButton title="Close"><Icon name="x" size={14} /></IconButton>
  </div>
);

export const ActiveAndTone = () => (
  <div style={dark}>
    <IconButton title="Pointer" active ariaPressed tone="tertiary"><Icon name="cursor" size={14} /></IconButton>
    <IconButton title="Razor" tone="tertiary"><Icon name="scissors" size={14} /></IconButton>
    <IconButton title="Grid" active><Icon name="grid" size={14} /></IconButton>
    <IconButton title="List"><Icon name="list" size={14} /></IconButton>
  </div>
);

export const FramesAndDisabled = () => (
  <div style={dark}>
    <IconButton frame="xs" title="Small"><Icon name="eye" size={10} /></IconButton>
    <IconButton frame="mdLg" title="Default"><Icon name="eye" size={14} /></IconButton>
    <IconButton frame="xl" title="Large"><Icon name="eye" size={18} /></IconButton>
    <IconButton disabled title="Disabled"><Icon name="trash" size={14} /></IconButton>
  </div>
);
