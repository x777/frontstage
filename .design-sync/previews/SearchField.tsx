import { SearchField } from "@palmier/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", padding: 16, display: "flex", flexDirection: "column", gap: 10, width: 300 };

export const Basic = () => (
  <div style={dark}>
    <SearchField value="" onChange={() => {}} placeholder="Search" />
    <SearchField value="sunset b-roll" onChange={() => {}} placeholder="Search" />
  </div>
);
