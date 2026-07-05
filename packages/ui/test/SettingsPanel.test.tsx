import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsPanel } from "../src/agent/SettingsPanel.js";
import type { McpSettings, RelayConfig } from "../src/agent/SettingsPanel.js";
import type { ModelEntry, SkillStorage, SkillCatalogDeps } from "@frontstage/ai";
import { SkillStore, SkillCatalog } from "@frontstage/ai";

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
    confirmThreshold: 50,
    onConfirmThresholdChange: vi.fn(),
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
      confirmThreshold={50}
      onConfirmThresholdChange={vi.fn()}
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

// --- fal.ai key section tests ---

test("SettingsPanel fal keychain: renders both the OpenRouter and fal.ai key sections", () => {
  const props = makeKeychainProps(false);
  render(
    <SettingsPanel
      {...props}
      falKeyConfig={{ kind: "keychain", hasKey: false, onSetKey: vi.fn(), onClearKey: vi.fn() }}
    />,
  );
  // OpenRouter section (regression)
  expect(screen.getByTestId("settings-key-status").textContent).toContain("No key set");
  expect(screen.getByTestId("settings-key")).toBeTruthy();
  // fal.ai section
  expect(screen.getByTestId("settings-fal")).toBeTruthy();
  expect(screen.getByTestId("settings-fal-key-status").textContent).toContain("No key set");
});

test("SettingsPanel fal keychain: typing a key and clicking Save calls the fal onSetKey", async () => {
  const onSetKey = vi.fn();
  const props = makeKeychainProps(false);
  render(
    <SettingsPanel
      {...props}
      falKeyConfig={{ kind: "keychain", hasKey: false, onSetKey, onClearKey: vi.fn() }}
    />,
  );
  fireEvent.change(screen.getByTestId("settings-fal-key"), { target: { value: "fal-test-456" } });
  await act(async () => { fireEvent.click(screen.getByTestId("settings-fal-key-save")); });
  expect(onSetKey).toHaveBeenCalledWith("fal-test-456");
  // OpenRouter's onSetKey must be untouched
  expect(props.keyConfig.onSetKey).not.toHaveBeenCalled();
});

test("SettingsPanel fal keychain: Remove button calls the fal onClearKey", async () => {
  const onClearKey = vi.fn();
  const props = makeKeychainProps(false);
  render(
    <SettingsPanel
      {...props}
      falKeyConfig={{ kind: "keychain", hasKey: true, onSetKey: vi.fn(), onClearKey }}
    />,
  );
  await act(async () => { fireEvent.click(screen.getByTestId("settings-fal-key-remove")); });
  expect(onClearKey).toHaveBeenCalledTimes(1);
});

test("SettingsPanel fal proxyInfo: enabled shows the configured line", () => {
  const props = makeKeychainProps(false);
  render(<SettingsPanel {...props} falKeyConfig={{ kind: "proxyInfo", enabled: true }} />);
  expect(screen.getByTestId("settings-fal-proxy-status").textContent).toContain("configured on proxy");
});

test("SettingsPanel fal proxyInfo: disabled shows the hint to set FAL_KEY on the proxy", () => {
  const props = makeKeychainProps(false);
  render(<SettingsPanel {...props} falKeyConfig={{ kind: "proxyInfo", enabled: false }} />);
  expect(screen.getByTestId("settings-fal-proxy-status").textContent).toContain("set FAL_KEY on your proxy");
});

test("SettingsPanel: fal.ai section absent when falKeyConfig prop is not provided", () => {
  render(<SettingsPanel {...makeKeychainProps()} />);
  expect(screen.queryByTestId("settings-fal")).toBeNull();
});

// --- generation confirm threshold tests (M14C T1) ---

test("SettingsPanel: confirm-threshold field renders the current value and hints '0 = always ask'", () => {
  render(<SettingsPanel {...makeKeychainProps()} confirmThreshold={50} />);
  const input = screen.getByTestId("settings-confirm-threshold") as HTMLInputElement;
  expect(input.value).toBe("50");
  expect(screen.getByTestId("settings-generation").textContent).toContain("0 = always ask");
});

test("SettingsPanel: editing the confirm-threshold field calls onConfirmThresholdChange with the number", () => {
  const onConfirmThresholdChange = vi.fn();
  render(<SettingsPanel {...makeKeychainProps()} confirmThreshold={50} onConfirmThresholdChange={onConfirmThresholdChange} />);
  fireEvent.change(screen.getByTestId("settings-confirm-threshold"), { target: { value: "10" } });
  expect(onConfirmThresholdChange).toHaveBeenCalledWith(10);
});

test("SettingsPanel: the confirm-threshold field accepts 0 (always ask)", () => {
  const onConfirmThresholdChange = vi.fn();
  render(<SettingsPanel {...makeKeychainProps()} confirmThreshold={50} onConfirmThresholdChange={onConfirmThresholdChange} />);
  fireEvent.change(screen.getByTestId("settings-confirm-threshold"), { target: { value: "0" } });
  expect(onConfirmThresholdChange).toHaveBeenCalledWith(0);
});

test("SettingsPanel: clearing the confirm-threshold field restores the default (50), not 0", () => {
  // Number("") is 0, not NaN — clearing the input must not silently become "always ask".
  const onConfirmThresholdChange = vi.fn();
  render(<SettingsPanel {...makeKeychainProps()} confirmThreshold={10} onConfirmThresholdChange={onConfirmThresholdChange} />);
  fireEvent.change(screen.getByTestId("settings-confirm-threshold"), { target: { value: "" } });
  expect(onConfirmThresholdChange).toHaveBeenCalledWith(50);
});

// --- Skills section (M15 T3) ---

class FakeSkillStorage implements SkillStorage {
  async list() { return []; }
  async read() { return null; }
  async write() { /* no-op */ }
  async remove() { /* no-op */ }
  async readLedger() { return {}; }
  async writeLedger() { /* no-op */ }
}

function makeSkillsProps() {
  const deps: SkillCatalogDeps = {
    fetchText: async (url: string) => (url.endsWith("catalog.json") ? "[]" : ""),
    cacheRead: async () => null,
    cacheWrite: async () => {},
  };
  return { store: new SkillStore(new FakeSkillStorage()), catalog: new SkillCatalog(deps) };
}

test("SettingsPanel: Skills section renders the SkillsPane when the skills prop is provided", async () => {
  render(<SettingsPanel {...makeKeychainProps()} skills={makeSkillsProps()} />);
  expect(await screen.findByTestId("settings-skills")).toBeTruthy();
  expect(screen.getByTestId("skills-pane")).toBeTruthy();
});

test("SettingsPanel: Skills section absent when the skills prop is not provided", () => {
  render(<SettingsPanel {...makeKeychainProps()} />);
  expect(screen.queryByTestId("settings-skills")).toBeNull();
});

// --- relay (M18C T2: cloud sign-in + browser-stored BYO keys) ---

function withMockedLocation(fn: () => void) {
  const original = window.location;
  // Object.defineProperty's descriptor.value is `any`, sidestepping the direct-assignment type
  // error TS raises for window.location (lib.dom.d.ts types its setter/getter asymmetrically).
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(window, "location", { value: original, writable: true, configurable: true });
  }
}

function makeRelayProps(auth: RelayConfig["auth"]): RelayConfig {
  return { auth, falKey: "", openRouterKey: "", onSaveKeys: vi.fn() };
}

test("SettingsPanel relay: not provided — no relay section, OpenRouter/fal sections render as before", () => {
  render(<SettingsPanel {...makeKeychainProps()} falKeyConfig={{ kind: "proxyInfo", enabled: true }} />);
  expect(screen.queryByTestId("settings-relay")).toBeNull();
  expect(screen.getByTestId("settings-key")).toBeTruthy();
  expect(screen.getByTestId("settings-fal")).toBeTruthy();
});

test("SettingsPanel relay: provided — replaces the OpenRouter section and hides the fal.ai section", () => {
  const relay = makeRelayProps({ status: "signedOut", loginUrl: () => "https://relay.example/api/auth/google" });
  render(<SettingsPanel {...makeKeychainProps()} falKeyConfig={{ kind: "proxyInfo", enabled: true }} relay={relay} />);
  expect(screen.getByTestId("settings-relay")).toBeTruthy();
  expect(screen.queryByTestId("settings-key")).toBeNull();
  expect(screen.queryByTestId("settings-fal")).toBeNull();
});

test("SettingsPanel relay signedOut: shows Sign in with Google/GitHub buttons", () => {
  const relay = makeRelayProps({ status: "signedOut", loginUrl: (p) => `https://relay.example/api/auth/${p}` });
  render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
  expect(screen.getByTestId("settings-relay-google").textContent).toContain("Google");
  expect(screen.getByTestId("settings-relay-github").textContent).toContain("GitHub");
});

test("SettingsPanel relay signedOut: clicking Sign in with Google navigates to loginUrl('google')", () => {
  withMockedLocation(() => {
    const relay = makeRelayProps({ status: "signedOut", loginUrl: (p) => `https://relay.example/api/auth/${p}` });
    render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
    fireEvent.click(screen.getByTestId("settings-relay-google"));
    expect(window.location.href).toBe("https://relay.example/api/auth/google");
  });
});

test("SettingsPanel relay signedOut: clicking Sign in with GitHub navigates to loginUrl('github')", () => {
  withMockedLocation(() => {
    const relay = makeRelayProps({ status: "signedOut", loginUrl: (p) => `https://relay.example/api/auth/${p}` });
    render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
    fireEvent.click(screen.getByTestId("settings-relay-github"));
    expect(window.location.href).toBe("https://relay.example/api/auth/github");
  });
});

test("SettingsPanel relay signedIn: shows the user's name, provider, and a Logout button", () => {
  const onLogout = vi.fn();
  const relay = makeRelayProps({ status: "signedIn", user: { name: "Ada Lovelace", provider: "google" }, onLogout });
  render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
  const userLine = screen.getByTestId("settings-relay-user").textContent ?? "";
  expect(userLine).toContain("Ada Lovelace");
  expect(userLine).toContain("google");
  expect(screen.getByTestId("settings-relay-logout")).toBeTruthy();
});

test("SettingsPanel relay signedIn: clicking Logout calls onLogout", () => {
  const onLogout = vi.fn();
  const relay = makeRelayProps({ status: "signedIn", user: { name: "Ada", provider: "github" }, onLogout });
  render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
  fireEvent.click(screen.getByTestId("settings-relay-logout"));
  expect(onLogout).toHaveBeenCalledTimes(1);
});

test("SettingsPanel relay signedIn: shows the 'Keys stay in this browser.' copy and two password fields", () => {
  const relay = makeRelayProps({ status: "signedIn", user: { name: "Ada", provider: "github" }, onLogout: vi.fn() });
  render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
  expect(screen.getByTestId("settings-relay").textContent).toContain("Keys stay in this browser.");
  expect(screen.getByTestId("settings-relay-fal-key").getAttribute("type")).toBe("password");
  expect(screen.getByTestId("settings-relay-openrouter-key").getAttribute("type")).toBe("password");
});

test("SettingsPanel relay signedIn: typing the fal key calls onSaveKeys({ falKey })", () => {
  const onSaveKeys = vi.fn();
  const relay: RelayConfig = { auth: { status: "signedIn", user: { name: "Ada", provider: "github" }, onLogout: vi.fn() }, falKey: "", openRouterKey: "", onSaveKeys };
  render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
  fireEvent.change(screen.getByTestId("settings-relay-fal-key"), { target: { value: "fal-new-key" } });
  expect(onSaveKeys).toHaveBeenCalledWith({ falKey: "fal-new-key" });
});

test("SettingsPanel relay signedIn: typing the OpenRouter key calls onSaveKeys({ openRouterKey })", () => {
  const onSaveKeys = vi.fn();
  const relay: RelayConfig = { auth: { status: "signedIn", user: { name: "Ada", provider: "github" }, onLogout: vi.fn() }, falKey: "", openRouterKey: "", onSaveKeys };
  render(<SettingsPanel {...makeKeychainProps()} relay={relay} />);
  fireEvent.change(screen.getByTestId("settings-relay-openrouter-key"), { target: { value: "or-new-key" } });
  expect(onSaveKeys).toHaveBeenCalledWith({ openRouterKey: "or-new-key" });
});
