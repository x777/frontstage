import { Button } from "@palmier/ui";

// Dark-first DS: cards paint the app's base background themselves.
const dark: React.CSSProperties = {
  background: "var(--bg-base)",
  padding: 16,
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

export const Variants = () => (
  <div style={dark}>
    <Button>Import</Button>
    <Button variant="accent">Generate</Button>
    <Button variant="destructive">Delete Clip</Button>
    <Button variant="accent" gradient="ai">Agent Mode</Button>
  </div>
);

export const Sizes = () => (
  <div style={dark}>
    <Button size="small">Save</Button>
    <Button size="regular">Save Project</Button>
    <Button size="small" variant="accent">Export</Button>
    <Button size="regular" variant="accent">Export Video</Button>
  </div>
);

export const RectCTA = () => (
  <div style={{ ...dark, flexDirection: "column", alignItems: "stretch", width: 280 }}>
    <Button shape="rect" variant="accent" style={{ width: "100%" }}>
      Create Matte
    </Button>
    <Button shape="rect" style={{ width: "100%" }}>
      Generate Captions
    </Button>
  </div>
);

export const Disabled = () => (
  <div style={dark}>
    <Button disabled>Import</Button>
    <Button variant="accent" disabled>Generate</Button>
    <Button variant="destructive" disabled>Delete</Button>
  </div>
);
