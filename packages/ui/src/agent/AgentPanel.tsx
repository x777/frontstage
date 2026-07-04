import { useState, useRef, useEffect } from "react";
import type { AgentSession, AgentMessage, AgentContentBlock, ChatSessionStore, MentionContext, ToolBlock, ModelEntry } from "@palmier/ai";
import { toolResultToText } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { useAgentSession } from "./use-agent-session.js";
import { SessionSwitcher } from "./SessionSwitcher.js";
import { MentionInput, type MentionItem } from "./MentionInput.js";
import { ModelPicker } from "./ModelPicker.js";

export interface AgentPanelProps {
  session: AgentSession;
  model?: string;
  sessionStore?: ChatSessionStore;
  mentionItems?: MentionItem[];
  llmModels?: ModelEntry[];
  onModelChange?: (id: string) => void;
  onOpenSkills?: () => void;
}

function joinTextBlocks(content: AgentContentBlock[]): string {
  return content
    .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
    .map((b) => b.text)
    .join(" ");
}

function MessageRow({ msg }: { msg: AgentMessage }) {
  if (msg.role === "user") {
    return (
      <div
        data-testid="agent-msg-user"
        style={{
          padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          marginBottom: theme.spacing.xs,
          background: theme.bg.surface,
          borderRadius: theme.radius.sm,
          color: theme.text.primary,
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.regular,
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
          padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          marginBottom: theme.spacing.xs,
          color: theme.text.primary,
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.regular,
          maxWidth: "100%",
          wordBreak: "break-word",
        }}
      >
        {joinTextBlocks(msg.content)}
        {toolCallBlocks.map((tc) => (
          <span
            key={tc.id}
            data-testid="agent-toolcall"
            style={{
              display: "inline-block",
              marginLeft: theme.spacing.xs,
              marginTop: theme.spacing.xxs,
              padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
              background: theme.bg.raised,
              borderRadius: theme.radius.xs,
              fontSize: theme.fontSize.xxs,
              color: theme.text.secondary,
              border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
            }}
          >
            → {tc.name}
          </span>
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
              marginBottom: theme.spacing.xxs,
              fontSize: theme.fontSize.xxs,
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
            padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
            borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {(llmModels && onModelChange) ? (
              <ModelPicker testid="agent-model-picker" models={llmModels} value={model ?? ""} onChange={onModelChange} />
            ) : model != null ? (
              <span
                data-testid="agent-model"
                style={{ fontSize: theme.fontSize.xxs, color: theme.text.muted, fontWeight: theme.fontWeight.regular }}
              >
                {model}
              </span>
            ) : null}
          </div>
          {onOpenSkills && (
            <button
              data-testid="agent-skills-button"
              onClick={onOpenSkills}
              title="View Skills"
              style={{
                background: "none",
                border: "none",
                color: theme.text.tertiary,
                cursor: "pointer",
                fontSize: theme.fontSize.sm,
                fontWeight: theme.fontWeight.medium,
                padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                flexShrink: 0,
              }}
            >
              Skills
            </button>
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
          padding: theme.spacing.sm,
          gap: theme.spacing.xxs,
        }}
      >
        {state.messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}

        {state.streaming != null && (
          <div
            data-testid="agent-streaming"
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              marginBottom: theme.spacing.xs,
              color: theme.text.secondary,
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.regular,
            }}
          >
            {state.streaming.text}
            <span
              style={{
                marginLeft: theme.spacing.xxs,
                color: theme.text.muted,
              }}
            >
              …
            </span>
            {state.streaming.toolCalls.map((tc) => (
              <span
                key={tc.id}
                data-testid="agent-toolcall"
                style={{
                  display: "inline-block",
                  marginLeft: theme.spacing.xs,
                  padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                  background: theme.bg.raised,
                  borderRadius: theme.radius.xs,
                  fontSize: theme.fontSize.xxs,
                  color: theme.text.secondary,
                  border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
                }}
              >
                → {tc.name}
              </span>
            ))}
          </div>
        )}

        {state.status === "error" && state.error != null && (
          <div
            data-testid="agent-error"
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              marginBottom: theme.spacing.xs,
              color: theme.status.error,
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.regular,
              background: theme.bg.surface,
              borderRadius: theme.radius.sm,
              border: `${theme.borderWidth.hairline} solid ${theme.status.error}`,
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
          padding: theme.spacing.sm,
          borderTop: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
          flexShrink: 0,
          gap: theme.spacing.xxs,
        }}
      >
        {isBusy && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              data-testid="agent-cancel"
              onClick={() => session.cancel()}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                background: theme.bg.raised,
                color: theme.text.secondary,
                border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
                borderRadius: theme.radius.sm,
                fontSize: theme.fontSize.sm,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
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
