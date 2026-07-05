import { useState, useEffect } from "react";
import type { ModelEntry } from "@frontstage/ai";
import { theme } from "../theme/theme.js";
import { Button, IconButton, TextInput, Checkbox, Icon, type IconName } from "../primitives/index.js";
import { ModelPicker } from "./ModelPicker.js";
import { DEFAULT_CONFIRM_THRESHOLD } from "./generation-settings.js";
import { SkillsPane, type SkillsPaneProps } from "../skills/SkillsPane.js";

// Icon-in-capsule sizing — same family as GenerationPanel's close/submit glyphs (M16E T2).
const CLOSE_ICON_SIZE = 14;
const REMOVE_ICON_SIZE = 14;
const TAB_ICON_SIZE = 15;

// Canonical row language (M16D InspectorView.sectionTitleLabel / fields.tsx Section; reused by
// M16E T2's GenerationPanel): eyebrow section headers xxs/semibold/wide-tracking/muted/uppercase,
// field labels sm/medium/primary. The single row authority for this pane too.
const sectionHeaderStyle: React.CSSProperties = {
  fontSize: theme.fontSize.xxs,
  fontWeight: theme.fontWeight.semibold,
  color: theme.text.muted,
  letterSpacing: theme.letterSpacing.wide,
  textTransform: "uppercase",
};
const fieldLabelStyle: React.CSSProperties = {
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.text.primary,
};
const fullWidthInput: React.CSSProperties = { width: "100%", boxSizing: "border-box" };

// An eyebrow-headed block inside a pane (SwiftUI Settings sections: OpenRouter / fal.ai / MCP Server).
function PaneSection({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
      <span style={sectionHeaderStyle}>{header}</span>
      {children}
    </div>
  );
}

export type KeyConfig =
  | { kind: "keychain"; hasKey: boolean; onSetKey: (k: string) => Promise<void>; onClearKey: () => Promise<void> }
  | { kind: "proxy"; proxyUrl: string; proxyToken?: string; onSave: (url: string, token?: string) => void };

export type FalKeyConfig =
  | { kind: "keychain"; hasKey: boolean; onSetKey: (k: string) => void | Promise<void>; onClearKey: () => void | Promise<void> }
  | { kind: "proxyInfo"; enabled: boolean };

interface KeychainLike {
  hasKey: boolean;
  onSetKey: (k: string) => void | Promise<void>;
  onClearKey: () => void | Promise<void>;
}

export interface McpSettings {
  getStatus: () => Promise<{ enabled: boolean; running: boolean; url: string; token: string }>;
  setEnabled: (on: boolean) => Promise<{ enabled: boolean }>;
  regenerateToken: () => Promise<string>;
}

// The web relay's account pane (M18C T2) — OAuth sign-in + browser-resident BYO keys, in place of
// the self-host proxy's OpenRouter/fal.ai sections when a site is served through the cloud relay.
export type RelayAuthState =
  | { status: "signedOut"; loginUrl: (provider: "google" | "github") => string }
  | { status: "signedIn"; user: { name: string; provider: string }; onLogout: () => void };

export interface RelayConfig {
  auth: RelayAuthState;
  falKey: string;
  openRouterKey: string;
  onSaveKeys: (keys: { falKey?: string; openRouterKey?: string }) => void;
}

export interface SettingsPanelProps {
  keyConfig: KeyConfig;
  falKeyConfig?: FalKeyConfig;
  llmModels: ModelEntry[];
  imageModels: ModelEntry[];
  agentModel: string;
  imageModel: string;
  onAgentModelChange: (id: string) => void;
  onImageModelChange: (id: string) => void;
  confirmThreshold: number;
  onConfirmThresholdChange: (value: number) => void;
  onClose?: () => void;
  mcp?: McpSettings;
  skills?: SkillsPaneProps;
  relay?: RelayConfig;
}

function KeychainConfig({
  cfg,
  testidPrefix = "settings-key",
  placeholder = "Paste OpenRouter key…",
}: {
  cfg: KeychainLike;
  testidPrefix?: string;
  placeholder?: string;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!keyInput.trim() || busy) return;
    setBusy(true);
    try { await cfg.onSetKey(keyInput.trim()); setKeyInput(""); } finally { setBusy(false); }
  }

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    try { await cfg.onClearKey(); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
      <span
        data-testid={`${testidPrefix}-status`}
        style={{ fontSize: theme.fontSize.xs, color: cfg.hasKey ? theme.text.secondary : theme.text.muted }}
      >
        {cfg.hasKey ? "Key configured" : "No key set"}
      </span>
      <TextInput
        type="password"
        testid={testidPrefix}
        value={keyInput}
        onChange={setKeyInput}
        placeholder={placeholder}
        style={fullWidthInput}
      />
      <div style={{ display: "flex", gap: theme.spacing.xs }}>
        {/* AgentPane.trailingControl: Save = .capsule(.prominent, size: .regular). */}
        <Button testid={`${testidPrefix}-save`} variant="accent" size="regular" disabled={!keyInput.trim() || busy} onClick={handleSave}>
          Save
        </Button>
        {cfg.hasKey && (
          // AgentPane.trailingControl: Remove = trash icon in a .capsule(.secondary, size: .regular);
          // styled destructive here since it's an irreversible action and this kit has no neutral
          // icon-capsule variant distinct from Save's accent one.
          <Button
            testid={`${testidPrefix}-remove`}
            variant="destructive"
            size="regular"
            disabled={busy}
            onClick={handleRemove}
            title="Remove key"
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="trash" size={REMOVE_ICON_SIZE} />
          </Button>
        )}
      </div>
    </div>
  );
}

function ProxyConfig({ cfg }: { cfg: Extract<KeyConfig, { kind: "proxy" }> }) {
  // Seeded from props once; the settings panel is a modal that remounts on open, so no re-sync is needed.
  const [url, setUrl] = useState(cfg.proxyUrl);
  const [token, setToken] = useState(cfg.proxyToken ?? "");
  const [saved, setSaved] = useState(false);

  function handleSave() {
    cfg.onSave(url, token || undefined);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
      <span
        data-testid="settings-proxy-status"
        style={{ fontSize: theme.fontSize.xs, color: saved ? theme.text.secondary : theme.text.muted }}
      >
        {saved ? "Saved (takes effect on reload)" : "Proxy endpoint"}
      </span>
      <TextInput testid="settings-proxy-url" value={url} onChange={setUrl} placeholder="https://…" style={fullWidthInput} />
      <TextInput type="password" testid="settings-proxy-token" value={token} onChange={setToken} placeholder="Token (optional)" style={fullWidthInput} />
      <Button testid="settings-proxy-save" variant="accent" onClick={handleSave} style={{ alignSelf: "flex-start" }}>
        Save
      </Button>
    </div>
  );
}

function FalProxyInfo({ cfg }: { cfg: Extract<FalKeyConfig, { kind: "proxyInfo" }> }) {
  return (
    <span
      data-testid="settings-fal-proxy-status"
      style={{ fontSize: theme.fontSize.xs, color: cfg.enabled ? theme.text.secondary : theme.text.muted }}
    >
      {cfg.enabled ? "fal.ai: configured on proxy ✓" : "fal.ai: not configured — set FAL_KEY on your proxy"}
    </span>
  );
}

// Signed-out: "Sign in with Google/GitHub" (navigates via loginUrl — a full-page redirect into the
// OAuth consent flow, not a fetch). Signed-in: name + provider + Logout + the two BYO key fields,
// persisted on every keystroke via onSaveKeys (mirrors the keychain fields' immediate-save feel).
function RelayAuthPane({ cfg }: { cfg: RelayConfig }) {
  const [falKey, setFalKey] = useState(cfg.falKey);
  const [openRouterKey, setOpenRouterKey] = useState(cfg.openRouterKey);

  if (cfg.auth.status === "signedOut") {
    const { loginUrl } = cfg.auth;
    return (
      <div data-testid="settings-relay" style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
        <span data-testid="settings-relay-status" style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>
          Not signed in
        </span>
        <div style={{ display: "flex", gap: theme.spacing.xs }}>
          <Button testid="settings-relay-google" onClick={() => { window.location.href = loginUrl("google"); }}>
            Sign in with Google
          </Button>
          <Button testid="settings-relay-github" onClick={() => { window.location.href = loginUrl("github"); }}>
            Sign in with GitHub
          </Button>
        </div>
      </div>
    );
  }

  const { user, onLogout } = cfg.auth;
  return (
    <div data-testid="settings-relay" style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span data-testid="settings-relay-user" style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary }}>
          {user.name} · {user.provider}
        </span>
        <Button testid="settings-relay-logout" size="small" onClick={onLogout}>
          Log out
        </Button>
      </div>
      <TextInput
        type="password"
        testid="settings-relay-fal-key"
        value={falKey}
        onChange={(v) => { setFalKey(v); cfg.onSaveKeys({ falKey: v }); }}
        placeholder="fal.ai key"
        style={fullWidthInput}
      />
      <TextInput
        type="password"
        testid="settings-relay-openrouter-key"
        value={openRouterKey}
        onChange={(v) => { setOpenRouterKey(v); cfg.onSaveKeys({ openRouterKey: v }); }}
        placeholder="OpenRouter key"
        style={fullWidthInput}
      />
      <span style={{ fontSize: theme.fontSize.xxs, color: theme.text.muted }}>Keys stay in this browser.</span>
    </div>
  );
}

function McpConfig({ cfg }: { cfg: McpSettings }) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const s = await cfg.getStatus();
    setEnabled(s.enabled);
    setUrl(s.url);
    setToken(s.token);
    setLoaded(true);
  }

  useEffect(() => { refresh().catch(() => {}); }, []);

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    try { await cfg.setEnabled(!enabled); await refresh(); } finally { setBusy(false); }
  }

  async function handleRegenerate() {
    if (busy) return;
    setBusy(true);
    try { await cfg.regenerateToken(); await refresh(); } finally { setBusy(false); }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(token);
  }

  if (!loaded) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs }}>
        <Checkbox testid="settings-mcp-enable" checked={enabled} disabled={busy} onChange={handleToggle} />
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary }}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {enabled && (
        <>
          <span
            data-testid="settings-mcp-url"
            style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, wordBreak: "break-all" }}
          >
            {url}
          </span>
          <span
            data-testid="settings-mcp-token"
            style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, wordBreak: "break-all" }}
          >
            {token}
          </span>
          <div style={{ display: "flex", gap: theme.spacing.xs }}>
            <Button testid="settings-mcp-copy" onClick={handleCopy}>Copy</Button>
            <Button testid="settings-mcp-regenerate" disabled={busy} onClick={handleRegenerate}>Regenerate</Button>
          </div>
        </>
      )}
    </div>
  );
}

function ConfirmThresholdField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <section
      data-testid="settings-generation"
      style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}
    >
      <span style={fieldLabelStyle}>Generation confirm threshold (credits)</span>
      <TextInput
        type="number"
        min={0}
        testid="settings-confirm-threshold"
        value={String(value)}
        onChange={(raw) => {
          if (raw.trim() === "") {
            // Number("") is 0, not NaN — an emptied field means "cleared", not "always ask".
            onChange(DEFAULT_CONFIRM_THRESHOLD);
            return;
          }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : DEFAULT_CONFIRM_THRESHOLD);
        }}
        style={fullWidthInput}
      />
      <span style={{ fontSize: theme.fontSize.xxs, color: theme.text.muted }}>
        Generations estimated above this many credits ask for confirmation first. 0 = always ask.
      </span>
    </section>
  );
}

// SwiftUI SettingsView.SidebarRowButton — icon + label; HoverHighlight language (idle transparent,
// hover white@faint, selected white@soft, selected+hover white@muted; radius-sm).
function SidebarRow({ label, icon, selected, onClick }: { label: string; icon: IconName; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const bgOpacity = selected
    ? (hovered ? theme.opacity.muted : theme.opacity.soft)
    : (hovered ? theme.opacity.faint : "0");
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.sm,
        width: "100%",
        padding: `${theme.spacing.xs} ${theme.spacing.smMd}`,
        border: "none",
        borderRadius: theme.radius.sm,
        background: `rgba(255, 255, 255, ${bgOpacity})`,
        color: selected ? theme.text.primary : theme.text.secondary,
        fontSize: theme.fontSize.sm,
        fontWeight: selected ? theme.fontWeight.medium : theme.fontWeight.regular,
        textAlign: "left",
        cursor: "pointer",
        transition: `background ${theme.anim.hover} ease-out`,
      }}
    >
      <Icon name={icon} size={TAB_ICON_SIZE} />
      <span>{label}</span>
    </button>
  );
}

type SettingsTab = "agent" | "generation" | "skills";

export function SettingsPanel({
  keyConfig,
  falKeyConfig,
  llmModels,
  imageModels,
  agentModel,
  imageModel,
  onAgentModelChange,
  onImageModelChange,
  confirmThreshold,
  onConfirmThresholdChange,
  onClose,
  mcp,
  skills,
  relay,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("agent");

  const tabs: { id: SettingsTab; label: string; icon: IconName }[] = [
    { id: "agent", label: "Agent", icon: "paperplane" },
    { id: "generation", label: "Generation", icon: "sparkles" },
    ...(skills ? [{ id: "skills" as const, label: "Skills", icon: "book" as IconName }] : []),
  ];
  const activeLabel = tabs.find((t) => t.id === tab)?.label ?? "Settings";
  // Every pane is mounted; only the active one is shown (display:none keeps testids/effects live).
  const paneStyle = (id: SettingsTab): React.CSSProperties => ({
    display: tab === id ? "flex" : "none",
    flexDirection: "column",
    gap: theme.spacing.lg,
  });

  return (
    <div
      data-testid="settings-panel"
      style={{
        position: "fixed",
        inset: 0,
        background: theme.bg.scrim,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: theme.z.dialog,
      }}
    >
      <div
        style={{
          background: theme.bg.raised,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.md,
          width: theme.size.settingsPanelW,
          maxWidth: "92vw",
          maxHeight: "85vh",
          boxShadow: theme.shadow.lg,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            width: theme.size.settingsSidebar,
            flexShrink: 0,
            borderRight: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
            display: "flex",
            flexDirection: "column",
            gap: theme.spacing.xxs,
            padding: `${theme.spacing.md} ${theme.spacing.smMd}`,
          }}
        >
          <span style={{ ...sectionHeaderStyle, padding: `0 ${theme.spacing.smMd}`, marginBottom: theme.spacing.xs }}>
            Settings
          </span>
          {tabs.map((t) => (
            <SidebarRow key={t.id} label={t.label} icon={t.icon} selected={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
        </div>

        {/* Detail */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: `${theme.spacing.lg} ${theme.spacing.xlXxl} ${theme.spacing.md}`,
            }}
          >
            <span
              style={{
                fontSize: theme.fontSize.title2,
                fontWeight: theme.fontWeight.light,
                letterSpacing: theme.letterSpacing.tight,
                color: theme.text.primary,
              }}
            >
              {activeLabel}
            </span>
            {onClose && (
              <IconButton testid="settings-close" onClick={onClose} title="Close" frame="smMd">
                <Icon name="x" size={CLOSE_ICON_SIZE} />
              </IconButton>
            )}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: `0 ${theme.spacing.xlXxl} ${theme.spacing.xlXxl}`,
            }}
          >
            {/* Agent: OpenRouter key · agent model · MCP server */}
            <div style={paneStyle("agent")}>
              {relay ? (
                <PaneSection header="Frontstage Cloud">
                  <RelayAuthPane cfg={relay} />
                </PaneSection>
              ) : (
                <PaneSection header="OpenRouter">
                  {keyConfig.kind === "keychain" ? <KeychainConfig cfg={keyConfig} /> : <ProxyConfig cfg={keyConfig} />}
                </PaneSection>
              )}
              <ModelPicker
                testid="settings-agent-model"
                label="Agent model"
                models={llmModels}
                value={agentModel}
                onChange={onAgentModelChange}
              />
              {mcp && (
                <section data-testid="settings-mcp" style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
                  <span style={sectionHeaderStyle}>MCP Server</span>
                  <McpConfig cfg={mcp} />
                </section>
              )}
            </div>

            {/* Generation: fal.ai key · image model · confirm threshold */}
            <div style={paneStyle("generation")}>
              {!relay && falKeyConfig && (
                <section data-testid="settings-fal" style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
                  <span style={sectionHeaderStyle}>fal.ai</span>
                  {falKeyConfig.kind === "keychain" ? (
                    <KeychainConfig cfg={falKeyConfig} testidPrefix="settings-fal-key" placeholder="Paste fal.ai key…" />
                  ) : (
                    <FalProxyInfo cfg={falKeyConfig} />
                  )}
                </section>
              )}
              <ModelPicker
                testid="settings-image-model"
                label="Image model"
                models={imageModels}
                value={imageModel}
                onChange={onImageModelChange}
              />
              <ConfirmThresholdField value={confirmThreshold} onChange={onConfirmThresholdChange} />
            </div>

            {/* Skills */}
            {skills && (
              <section data-testid="settings-skills" style={paneStyle("skills")}>
                <SkillsPane {...skills} />
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
