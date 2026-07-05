import { Icon, IconButton, PanelHeader } from "@palmier/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", width: 320, display: "flex", flexDirection: "column" };

export const Plain = () => (
  <div style={dark}>
    <PanelHeader title="Media" />
    <div style={{ height: 40 }} />
  </div>
);

export const WithTrailing = () => (
  <div style={dark}>
    <PanelHeader
      title="Inspector"
      trailing={<IconButton frame="smMd" title="Maximize"><Icon name="grid" size={12} /></IconButton>}
    />
    <div style={{ height: 40 }} />
  </div>
);
