import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import type { AgentSession, AgentMessage, AgentContentBlock } from "@palmier/ai";
import { toolResultToText } from "@palmier/ai";
import { theme } from "../theme/theme.js";
import { useAgentSession } from "./use-agent-session.js";

export interface AgentPanelProps {
  session: AgentSession;
  model?: string;
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
    (b): b is { kind: "toolResult"; toolCallId: string; blocks: import("@palmier/ai").ToolBlock[]; isError: boolean } =>
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

export function AgentPanel({ session, model }: AgentPanelProps) {
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
  const canSend = inputText.trim().length > 0 && !isBusy;

  async function handleSend() {
    if (!canSend) return;
    const text = inputText.trim();
    setInputText("");
    await session.send(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
      {model != null && (
        <div
          data-testid="agent-model"
          style={{
            padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
            fontSize: theme.fontSize.xxs,
            color: theme.text.muted,
            fontWeight: theme.fontWeight.regular,
            borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
            flexShrink: 0,
          }}
        >
          {model}
        </div>
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
          alignItems: "flex-end",
          gap: theme.spacing.xs,
          padding: theme.spacing.sm,
          borderTop: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
          flexShrink: 0,
        }}
      >
        <textarea
          data-testid="agent-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            background: theme.bg.surface,
            color: theme.text.primary,
            border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
            borderRadius: theme.radius.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.regular,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        {isBusy && (
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
              flexShrink: 0,
            }}
          >
            Cancel
          </button>
        )}
        <button
          data-testid="agent-send"
          onClick={handleSend}
          disabled={!canSend}
          style={{
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            background: canSend ? theme.accent.primary : theme.bg.raised,
            color: canSend ? theme.text.onAccent : theme.text.muted,
            border: "none",
            borderRadius: theme.radius.sm,
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.medium,
            cursor: canSend ? "pointer" : "not-allowed",
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
