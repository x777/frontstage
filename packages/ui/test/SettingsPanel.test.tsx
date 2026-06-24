import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsPanel } from "../src/agent/SettingsPanel.js";
import type { McpSettings } from "../src/agent/SettingsPanel.js";
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

// --- MCP section tests ---

function makeMcpSettings(initialEnabled = false): McpSettings {
  const statusDisabled = { enabled: false, running: false, url: "http://127.0.0.1:19789/mcp", token: "abc123token" };
  const statusEnabled = { enabled: true, running: true, url: "http://127.0.0.1:19789/mcp", token: "abc123token" };
  let callCount = 0;
  return {
    getStatus: vi.fn().mockImplementation(() => {
      callCount++;
      // First call returns initial state; after setEnabled(true) is called it returns enabled
      return Promise.resolve(callCount > 1 || initialEnabled ? statusEnabled : statusDisabled);
    }),
    setEnabled: vi.fn().mockResolvedValue({ enabled: true }),
    regenerateToken: vi.fn().mockResolvedValue("newtoken456"),
  };
}

test("SettingsPanel mcp: section renders when mcp prop is provided", async () => {
  const mcp = makeMcpSettings(true);
  render(<SettingsPanel {...makeKeychainProps()} mcp={mcp} />);
  expect(await screen.findByTestId("settings-mcp")).toBeTruthy();
});

test("SettingsPanel mcp: section absent when mcp prop is not provided", () => {
  render(<SettingsPanel {...makeKeychainProps()} />);
  expect(screen.queryByTestId("settings-mcp")).toBeNull();
});

test("SettingsPanel mcp: toggle calls setEnabled(true) and shows URL/token after re-fetch", async () => {
  const mcp = makeMcpSettings(false);
  render(<SettingsPanel {...makeKeychainProps()} mcp={mcp} />);
  // Wait for initial getStatus load
  await screen.findByTestId("settings-mcp-enable");
  await act(async () => {
    fireEvent.click(screen.getByTestId("settings-mcp-enable"));
  });
  expect(mcp.setEnabled).toHaveBeenCalledWith(true);
  // After re-getStatus, URL and token should appear
  const urlEl = await screen.findByTestId("settings-mcp-url");
  expect(urlEl.textContent).toContain("http://127.0.0.1:19789/mcp");
  expect(screen.getByTestId("settings-mcp-token").textContent).toContain("abc123token");
});

test("SettingsPanel mcp: Copy button writes token to clipboard", async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  const mcp = makeMcpSettings(true);
  render(<SettingsPanel {...makeKeychainProps()} mcp={mcp} />);
  await screen.findByTestId("settings-mcp-copy");
  await act(async () => {
    fireEvent.click(screen.getByTestId("settings-mcp-copy"));
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("abc123token");
});

test("SettingsPanel mcp: Regenerate button calls regenerateToken", async () => {
  const mcp = makeMcpSettings(true);
  render(<SettingsPanel {...makeKeychainProps()} mcp={mcp} />);
  await screen.findByTestId("settings-mcp-regenerate");
  await act(async () => {
    fireEvent.click(screen.getByTestId("settings-mcp-regenerate"));
  });
  expect(mcp.regenerateToken).toHaveBeenCalledTimes(1);
});
