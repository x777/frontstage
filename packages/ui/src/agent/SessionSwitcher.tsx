import { useState, useEffect, useCallback } from "react";
import type { AgentSession, ChatSessionStore, ChatSessionIndexEntry } from "@palmier/ai";
import { theme } from "../theme/theme.js";

interface SessionSwitcherProps {
  session: AgentSession;
  sessionStore: ChatSessionStore;
  onNew?: () => void;
}

export function SessionSwitcher({ session, sessionStore, onNew }: SessionSwitcherProps) {
  const [sessions, setSessions] = useState<ChatSessionIndexEntry[]>([]);

  const refresh = useCallback(async () => {
    const list = await sessionStore.list();
    setSessions(list);
  }, [sessionStore]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleNew() {
    const id = crypto.randomUUID();
    const freshDoc = {
      id,
      title: "New Chat",
      createdAt: new Date().toISOString(),
      messages: [] as import("@palmier/ai").AgentMessage[],
    };
    session.loadDoc(freshDoc);
    onNew?.();
    await refresh();
  }

  async function handleSelect(id: string) {
    const doc = await sessionStore.load(id);
    if (doc) {
      session.loadDoc(doc);
    }
    await refresh();
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
          gap: theme.spacing.xs,
        }}
      >
        <button
          data-testid="agent-new"
          onClick={handleNew}
          style={{
            background: "none",
            border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
            borderRadius: theme.radius.xs,
            color: theme.text.secondary,
            cursor: "pointer",
            fontSize: theme.fontSize.xxs,
            padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          New Chat
        </button>
      </div>

      {sessions.length > 0 && (
        <div
          style={{
            overflowY: "auto",
            maxHeight: "120px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {sessions.map((entry, i) => (
            <button
              key={entry.id}
              data-testid={`agent-session-${i}`}
              onClick={() => handleSelect(entry.id)}
              style={{
                background: "none",
                border: "none",
                borderTop: i === 0 ? "none" : `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
                color: theme.text.primary,
                cursor: "pointer",
                fontSize: theme.fontSize.xxs,
                padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {entry.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
