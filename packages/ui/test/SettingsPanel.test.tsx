import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsPanel } from "../src/agent/SettingsPanel.js";
import type { ModelEntry } from "@palmier/ai";

const LLM_MODELS: ModelEntry[] = [
  { id: "a/llm-1", label: "LLM One", kind: "llm" },
  { id: "a/llm-2", label: "LLM Two", kind: "llm" },
];
const IMG_MODELS: ModelEntry[] = [
  { id: "b/img-1", label: "Img One", kind: "image" },
];

function makeKeychainProps(hasKey = false) {
  return {
    keyConfig: {
      kind: "keychain" as const,
      hasKey,
      onSetKey: vi.fn().mockResolvedValue(undefined),
      onClearKey: vi.fn().mockResolvedValue(undefined),
    },
    llmModels: LLM_MODELS,
    imageModels: IMG_MODELS,
    agentModel: "a/llm-1",
    imageModel: "b/img-1",
    onAgentModelChange: vi.fn(),
    onImageModelChange: vi.fn(),
  };
}

test("SettingsPanel keychain: status shows No key set when hasKey=false", () => {
  render(<SettingsPanel {...makeKeychainProps(false)} />);
  expect(screen.getByTestId("settings-key-status").textContent).toContain("No key set");
});

test("SettingsPanel keychain: status shows Key configured when hasKey=true", () => {
  render(<SettingsPanel {...makeKeychainProps(true)} />);
  expect(screen.getByTestId("settings-key-status").textContent).toContain("Key configured");
});

test("SettingsPanel keychain: typing a key and clicking Save calls onSetKey", async () => {
  const props = makeKeychainProps(false);
  render(<SettingsPanel {...props} />);
  fireEvent.change(screen.getByTestId("settings-key"), { target: { value: "sk-test-123" } });
  await act(async () => { fireEvent.click(screen.getByTestId("settings-key-save")); });
  expect(props.keyConfig.onSetKey).toHaveBeenCalledWith("sk-test-123");
});

test("SettingsPanel keychain: Remove button calls onClearKey", async () => {
  const props = makeKeychainProps(true);
  render(<SettingsPanel {...props} />);
  await act(async () => { fireEvent.click(screen.getByTestId("settings-key-remove")); });
  expect(props.keyConfig.onClearKey).toHaveBeenCalledTimes(1);
});

test("SettingsPanel keychain: agent model picker fires onAgentModelChange", () => {
  const props = makeKeychainProps(false);
  render(<SettingsPanel {...props} />);
  fireEvent.change(screen.getByTestId("settings-agent-model"), { target: { value: "a/llm-2" } });
  expect(props.onAgentModelChange).toHaveBeenCalledWith("a/llm-2");
});

test("SettingsPanel keychain: image model picker fires onImageModelChange", () => {
  const props = makeKeychainProps(false);
  render(<SettingsPanel {...props} />);
  fireEvent.change(screen.getByTestId("settings-image-model"), { target: { value: "b/img-1" } });
  expect(props.onImageModelChange).toHaveBeenCalledWith("b/img-1");
});

test("SettingsPanel proxy: Save calls onSave with url and token", () => {
  const onSave = vi.fn();
  render(
    <SettingsPanel
      keyConfig={{ kind: "proxy", proxyUrl: "http://localhost:8787", onSave }}
      llmModels={LLM_MODELS}
      imageModels={IMG_MODELS}
      agentModel="a/llm-1"
      imageModel="b/img-1"
      onAgentModelChange={vi.fn()}
      onImageModelChange={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByTestId("settings-proxy-url"), { target: { value: "http://new-proxy.example.com" } });
  fireEvent.change(screen.getByTestId("settings-proxy-token"), { target: { value: "my-token" } });
  fireEvent.click(screen.getByTestId("settings-proxy-save"));
  expect(onSave).toHaveBeenCalledWith("http://new-proxy.example.com", "my-token");
});

test("SettingsPanel: close button calls onClose", () => {
  const onClose = vi.fn();
  render(<SettingsPanel {...makeKeychainProps()} onClose={onClose} />);
  fireEvent.click(screen.getByTestId("settings-close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});
