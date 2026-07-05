import { useState, useEffect } from "react";
import type { ModelEntry } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { Button, IconButton, TextInput, Checkbox, Icon } from "../primitives/index.js";
import { ModelPicker } from "./ModelPicker.js";
import { DEFAULT_CONFIRM_THRESHOLD } from "./generation-settings.js";
import { SkillsPane, type SkillsPaneProps } from "../skills/SkillsPane.js";

// Icon-in-capsule sizing — same family as GenerationPanel's close/submit glyphs (M16E T2).
const CLOSE_ICON_SIZE = 14;
const REMOVE_ICON_SIZE = 14;

// Canonical row language (M16D InspectorView.sectionTitleLabel / fields.tsx Section; reused by
// M16E T2's GenerationPanel): eyebrow section headers xxs/semibold/wide-tracking/muted/uppercase,
// field labels sm/medium/primary. Applied here to fal.ai / MCP Server / Skills section headers
// and the confirm-threshold field label — the single row authority for this pane too.
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
      style={{
        borderTop: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
        paddingTop: theme.spacing.sm,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.xxs,
      }}
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
}: SettingsPanelProps) {
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
          padding: theme.spacing.lg,
          minWidth: theme.size.settingsPanelMin,
          boxShadow: theme.shadow.lg,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.md,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
            Settings
          </span>
          {onClose && (
            <IconButton testid="settings-close" onClick={onClose} title="Close" frame="smMd">
              <Icon name="x" size={CLOSE_ICON_SIZE} />
            </IconButton>
          )}
        </div>

        {keyConfig.kind === "keychain" ? (
          <KeychainConfig cfg={keyConfig} />
        ) : (
          <ProxyConfig cfg={keyConfig} />
        )}

        {falKeyConfig && (
          <section
            data-testid="settings-fal"
            style={{
              borderTop: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
              paddingTop: theme.spacing.sm,
              display: "flex",
              flexDirection: "column",
              gap: theme.spacing.sm,
            }}
          >
            <span style={sectionHeaderStyle}>fal.ai</span>
            {falKeyConfig.kind === "keychain" ? (
              <KeychainConfig cfg={falKeyConfig} testidPrefix="settings-fal-key" placeholder="Paste fal.ai key…" />
            ) : (
              <FalProxyInfo cfg={falKeyConfig} />
            )}
          </section>
        )}

        <div
          style={{
            borderTop: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
            paddingTop: theme.spacing.sm,
            display: "flex",
            flexDirection: "column",
            gap: theme.spacing.sm,
          }}
        >
          <ModelPicker
            testid="settings-agent-model"
            label="Agent model"
            models={llmModels}
            value={agentModel}
            onChange={onAgentModelChange}
          />
          <ModelPicker
            testid="settings-image-model"
            label="Image model"
            models={imageModels}
            value={imageModel}
            onChange={onImageModelChange}
          />
        </div>

        <ConfirmThresholdField value={confirmThreshold} onChange={onConfirmThresholdChange} />

        {mcp && (
          <section
            data-testid="settings-mcp"
            style={{
              borderTop: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
              paddingTop: theme.spacing.sm,
              display: "flex",
              flexDirection: "column",
              gap: theme.spacing.sm,
            }}
          >
            <span style={sectionHeaderStyle}>MCP Server</span>
            <McpConfig cfg={mcp} />
          </section>
        )}

        {skills && (
          <section
            data-testid="settings-skills"
            style={{
              borderTop: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
              paddingTop: theme.spacing.sm,
              display: "flex",
              flexDirection: "column",
              gap: theme.spacing.sm,
            }}
          >
            <span style={sectionHeaderStyle}>Skills</span>
            <SkillsPane {...skills} />
          </section>
        )}
      </div>
    </div>
  );
}
