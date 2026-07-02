import { useState, useEffect } from "react";
import type { ModelEntry } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { ModelPicker } from "./ModelPicker.js";

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
  onClose?: () => void;
  mcp?: McpSettings;
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
      <input
        type="password"
        data-testid={testidPrefix}
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        placeholder={placeholder}
        style={{
          background: theme.bg.surface,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.xs,
          color: theme.text.primary,
          fontSize: theme.fontSize.sm,
          padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
          outline: "none",
          fontFamily: "inherit",
          width: "100%",
          boxSizing: "border-box" as const,
        }}
      />
      <div style={{ display: "flex", gap: theme.spacing.xs }}>
        <button
          data-testid={`${testidPrefix}-save`}
          disabled={!keyInput.trim() || busy}
          onClick={handleSave}
          style={{
            background: theme.accent.primary,
            border: "none",
            borderRadius: theme.radius.xs,
            color: theme.text.onAccent,
            cursor: !keyInput.trim() || busy ? "not-allowed" : "pointer",
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.medium,
            padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            opacity: !keyInput.trim() || busy ? theme.opacity.disabled : theme.opacity.opaque,
          }}
        >
          Save
        </button>
        {cfg.hasKey && (
          <button
            data-testid={`${testidPrefix}-remove`}
            disabled={busy}
            onClick={handleRemove}
            style={{
              background: "none",
              border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
              borderRadius: theme.radius.xs,
              color: theme.text.secondary,
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: theme.fontSize.sm,
              padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            }}
          >
            Remove
          </button>
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
      <input
        data-testid="settings-proxy-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        style={{
          background: theme.bg.surface,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.xs,
          color: theme.text.primary,
          fontSize: theme.fontSize.sm,
          padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
          outline: "none",
          fontFamily: "inherit",
          width: "100%",
          boxSizing: "border-box" as const,
        }}
      />
      <input
        type="password"
        data-testid="settings-proxy-token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Token (optional)"
        style={{
          background: theme.bg.surface,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.xs,
          color: theme.text.primary,
          fontSize: theme.fontSize.sm,
          padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
          outline: "none",
          fontFamily: "inherit",
          width: "100%",
          boxSizing: "border-box" as const,
        }}
      />
      <button
        data-testid="settings-proxy-save"
        onClick={handleSave}
        style={{
          background: theme.accent.primary,
          border: "none",
          borderRadius: theme.radius.xs,
          color: theme.text.onAccent,
          cursor: "pointer",
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.medium,
          padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
          alignSelf: "flex-start",
        }}
      >
        Save
      </button>
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
        <input
          type="checkbox"
          data-testid="settings-mcp-enable"
          checked={enabled}
          disabled={busy}
          onChange={handleToggle}
          style={{ cursor: busy ? "not-allowed" : "pointer" }}
        />
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
            <button
              data-testid="settings-mcp-copy"
              onClick={handleCopy}
              style={{
                background: "none",
                border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
                borderRadius: theme.radius.xs,
                color: theme.text.secondary,
                cursor: "pointer",
                fontSize: theme.fontSize.sm,
                padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
              }}
            >
              Copy
            </button>
            <button
              data-testid="settings-mcp-regenerate"
              disabled={busy}
              onClick={handleRegenerate}
              style={{
                background: "none",
                border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
                borderRadius: theme.radius.xs,
                color: theme.text.secondary,
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: theme.fontSize.sm,
                padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
              }}
            >
              Regenerate
            </button>
          </div>
        </>
      )}
    </div>
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
  onClose,
  mcp,
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
            <button
              data-testid="settings-close"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: theme.text.muted,
                cursor: "pointer",
                fontSize: theme.fontSize.md,
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="Close"
            >
              ×
            </button>
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
            <span style={{ fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
              fal.ai
            </span>
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
            <span style={{ fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
              MCP Server
            </span>
            <McpConfig cfg={mcp} />
          </section>
        )}
      </div>
    </div>
  );
}
