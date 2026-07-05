import { SegmentedTabs } from "@palmier/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", padding: 16, display: "flex", flexDirection: "column", gap: 12, width: 340 };

export const GenerationKinds = () => (
  <div style={dark}>
    <SegmentedTabs
      segments={[{ id: "video", label: "Video" }, { id: "image", label: "Image" }, { id: "audio", label: "Audio" }, { id: "upscale", label: "Upscale" }]}
      active="video"
      onSelect={() => {}}
    />
  </div>
);

export const TwoSegments = () => (
  <div style={dark}>
    <SegmentedTabs
      segments={[{ id: "view", label: "View" }, { id: "edit", label: "Edit" }]}
      active="edit"
      onSelect={() => {}}
    />
  </div>
);
