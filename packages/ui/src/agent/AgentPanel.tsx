import { useState, useRef, useEffect } from "react";
import type { AgentSession, AgentMessage, AgentContentBlock, ChatSessionStore, MentionContext, ToolBlock, ModelEntry } from "@palmier/ai";
import { toolResultToText } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { useAgentSession } from "./use-agent-session.js";
import { SessionSwitcher } from "./SessionSwitcher.js";
import { MentionInput, type MentionItem } from "./MentionInput.js";
import { ModelPicker } from "./ModelPicker.js";
import { Button, Icon, IconButton } from "../primitives/index.js";

export interface AgentPanelProps {
  session: AgentSession;
  model?: string;
  sessionStore?: ChatSessionStore;
  mentionItems?: MentionItem[];
  llmModels?: ModelEntry[];
  onModelChange?: (id: string) => void;
  onOpenSkills?: () => void;
}

// Icon glyph sizes — small glyphs inside larger hit boxes, matching TransportBar's precedent.
const SKILLS_ICON_SIZE = 14;
const CANCEL_ICON_SIZE = 10;

function joinTextBlocks(content: AgentContentBlock[]): string {
  return content
    .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
    .map((b) => b.text)
    .join(" ");
}

// AgentMessageView.ToolRunRow's name typography (mono, medium, tertiary) — shared by the
// committed assistant chip and the live streaming chip. No expand/collapse (that's tool-block
// rendering behavior, out of scope for a styling pass).
function ToolCallChip({ id, name }: { id: string; name: string }) {
  return (
    <span
      key={id}
      data-testid="agent-toolcall"
      style={{
        display: "inline-block",
        marginLeft: theme.spacing.xs,
        marginTop: theme.spacing.xxs,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        background: theme.bg.raised,
        borderRadius: theme.radius.xs,
        fontFamily: "ui-monospace, monospace",
        fontSize: theme.fontSize.sm,
        fontWeight: theme.fontWeight.medium,
        color: theme.text.tertiary,
        border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
      }}
    >
      → {name}
    </span>
  );
}

function MessageRow({ msg }: { msg: AgentMessage }) {
  if (msg.role === "user") {
    return (
      <div
        data-testid="agent-msg-user"
        style={{
          padding: `${theme.spacing.smMd} ${theme.spacing.lg}`,
          background: `rgba(255, 255, 255, ${theme.opacity.faint})`,
          borderRadius: theme.radius.lg,
          color: theme.text.primary,
          fontSize: theme.fontSize.md,
          fontWeight: theme.fontWeight.regular,
          lineHeight: 1.4,
          alignSelf: "flex-end",
          maxWidth: "80%",
          wordBreak: "break-word",
        }}
      >
        {joinTextBlocks(msg.content)}
      </div>
    );
  }

  if (msg.role === "assistant") {
    const toolCallBlocks = msg.content.filter(
      (b): b is { kind: "toolCall"; id: string; name: string; argsJson: string } =>
        b.kind === "toolCall",
    );
    return (
      <div
        data-testid="agent-msg-assistant"
        style={{
          color: theme.text.primary,
          fontSize: theme.fontSize.md,
          fontWeight: theme.fontWeight.regular,
          lineHeight: 1.4,
          maxWidth: "100%",
          wordBreak: "break-word",
        }}
      >
        {joinTextBlocks(msg.content)}
        {toolCallBlocks.map((tc) => (
          <ToolCallChip key={tc.id} id={tc.id} name={tc.name} />
        ))}
      </div>
    );
  }

  // role === "tool"
  const toolResultBlocks = msg.content.filter(
    (b): b is { kind: "toolResult"; toolCallId: string; blocks: ToolBlock[]; isError: boolean } =>
      b.kind === "toolResult",
  );
  return (
    <>
      {toolResultBlocks.map((tr) => {
        const firstLine = toolResultToText(tr.blocks).split("\n")[0] ?? "";
        return (
          <div
            key={tr.toolCallId}
            data-testid="agent-toolresult"
            style={{
              padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
              fontFamily: "ui-monospace, monospace",
              fontSize: theme.fontSize.xs,
              color: tr.isError ? theme.status.error : theme.text.tertiary,
              fontWeight: theme.fontWeight.regular,
              wordBreak: "break-word",
            }}
          >
            {firstLine}
          </div>
        );
      })}
    </>
  );
}

export function AgentPanel({ session, model, sessionStore, mentionItems, llmModels, onModelChange, onOpenSkills }: AgentPanelProps) {
  const state = useAgentSession(session);
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages or streaming update
  useEffect(() => {
    const el = messagesEndRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.messages, state.streaming]);

  const isBusy = state.status === "streaming" || state.status === "tools";

  async function handleSend(text: string, context?: MentionContext) {
    if (!text.trim() || isBusy) return;
    setInputText("");
    await session.send(text, context);
    if (sessionStore) {
      await sessionStore.save(session.toDoc());
    }
  }

  return (
    <div
      data-testid="agent-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.bg.base,
        color: theme.text.primary,
        fontSize: theme.fontSize.sm,
      }}
    >
      {((llmModels && onModelChange) || model != null || onOpenSkills) && (
        <div
          data-testid="agent-panel-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
            height: theme.size.panelHeader,
            boxSizing: "border-box",
            padding: `0 ${theme.spacing.sm}`,
            background: theme.bg.raised,
            borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {(llmModels && onModelChange) ? (
              <ModelPicker testid="agent-model-picker" models={llmModels} value={model ?? ""} onChange={onModelChange} />
            ) : model != null ? (
              <span
                data-testid="agent-model"
                style={{ fontSize: theme.fontSize.xs, color: theme.text.secondary, fontWeight: theme.fontWeight.medium }}
              >
                {model}
              </span>
            ) : null}
          </div>
          {onOpenSkills && (
            <IconButton
              testid="agent-skills-button"
              onClick={onOpenSkills}
              title="View Skills"
              frame="smMd"
            >
              <Icon name="book" size={SKILLS_ICON_SIZE} />
            </IconButton>
          )}
        </div>
      )}

      {sessionStore && (
        <SessionSwitcher session={session} sessionStore={sessionStore} />
      )}

      <div
        data-testid="agent-messages"
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          padding: `${theme.spacing.sm} ${theme.spacing.lgXl}`,
          gap: theme.spacing.xl,
        }}
      >
        {state.messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}

        {state.streaming != null && (
          <div
            data-testid="agent-streaming"
            style={{
              color: theme.text.primary,
              fontSize: theme.fontSize.md,
              fontWeight: theme.fontWeight.regular,
              lineHeight: 1.4,
            }}
          >
            {state.streaming.text}
            <span
              style={{
                marginLeft: theme.spacing.xxs,
                fontWeight: theme.fontWeight.semibold,
                background: theme.gradients.ai,
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                animation: `gradient-text-shimmer ${theme.anim.shimmerDuration} linear infinite`,
              }}
            >
              …
            </span>
            {state.streaming.toolCalls.map((tc) => (
              <ToolCallChip key={tc.id} id={tc.id} name={tc.name} />
            ))}
          </div>
        )}

        {state.status === "error" && state.error != null && (
          <div
            data-testid="agent-error"
            style={{
              color: theme.status.error,
              fontSize: theme.fontSize.xs,
              fontWeight: theme.fontWeight.regular,
            }}
          >
            {state.error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: `${theme.spacing.xs} ${theme.spacing.mdLg} ${theme.spacing.mdLg}`,
          flexShrink: 0,
          gap: theme.spacing.xxs,
        }}
      >
        {isBusy && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button testid="agent-cancel" size="small" onClick={() => session.cancel()}>
              <span style={{ display: "flex", alignItems: "center", gap: theme.spacing.xxs }}>
                <Icon name="x" size={CANCEL_ICON_SIZE} />
                Cancel
              </span>
            </Button>
          </div>
        )}
        <MentionInput
          value={inputText}
          onChange={setInputText}
          onSend={handleSend}
          disabled={isBusy}
          mentionItems={mentionItems ?? []}
        />
      </div>
    </div>
  );
}
