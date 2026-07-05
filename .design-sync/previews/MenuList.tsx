import { MenuList } from "@palmier/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", padding: 16, display: "inline-block" };

export const FileMenu = () => (
  <div style={dark}>
    <MenuList
      onSelect={() => {}}
      items={[
        { id: "new", label: "New" },
        { id: "open", label: "Open…" },
        { id: "recent", label: "Open Recent", header: true },
        { id: "p1", label: "Sunset Cut v3" },
        { id: "p2", label: "Interview Master" },
        { id: "save", label: "Save", separatorBefore: true },
        { id: "saveas", label: "Save As…" },
        { id: "export", label: "Export Video (MP4)…", separatorBefore: true },
      ]}
    />
  </div>
);

export const States = () => (
  <div style={dark}>
    <MenuList
      onSelect={() => {}}
      items={[
        { id: "copy", label: "Copy" },
        { id: "paste", label: "Paste", disabled: true },
        { id: "split", label: "Split at Playhead" },
        { id: "delete", label: "Delete Clip", destructive: true, separatorBefore: true },
      ]}
    />
  </div>
);
