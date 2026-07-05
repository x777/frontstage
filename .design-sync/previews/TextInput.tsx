import { TextInput } from "@frontstage/ui";

const dark: React.CSSProperties = {
  background: "var(--bg-base)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: 300,
};

export const Basic = () => (
  <div style={dark}>
    <TextInput value="Sunset Cut v3" onChange={() => {}} />
    <TextInput value="" onChange={() => {}} placeholder="Paste fal.ai key…" />
  </div>
);

export const PasswordAndNumber = () => (
  <div style={dark}>
    <TextInput type="password" value="sk-secret-key-000" onChange={() => {}} />
    <TextInput type="number" value="50" min={0} onChange={() => {}} />
  </div>
);

export const Disabled = () => (
  <div style={dark}>
    <TextInput value="Locked while rendering…" disabled onChange={() => {}} />
  </div>
);
