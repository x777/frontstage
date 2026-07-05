import { Select } from "@palmier/ui";

const dark: React.CSSProperties = { background: "var(--bg-base)", padding: 16, display: "flex", flexDirection: "column", gap: 10, width: 280 };

export const Basic = () => (
  <div style={dark}>
    <Select
      value="veo"
      options={[{ value: "veo", label: "Veo 3.1 Fast" }, { value: "kling", label: "Kling 2.5" }, { value: "seedance", label: "Seedance 1.0" }]}
      onChange={() => {}}
    />
    <Select
      value={null}
      placeholder="Choose a model"
      options={[{ value: "a", label: "Claude Sonnet 5" }, { value: "b", label: "GPT-5" }]}
      onChange={() => {}}
    />
  </div>
);
