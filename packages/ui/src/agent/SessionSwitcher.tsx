import { useState, useEffect, useCallback } from "react";
import type { AgentSession, ChatSessionStore, ChatSessionIndexEntry } from "@frontstage/ai";
import { theme } from "../theme/theme.js";
import { Button, Icon, MenuList } from "../primitives/index.js";

interface SessionSwitcherProps {
  session: AgentSession;
  sessionStore: ChatSessionStore;
  onNew?: () => void;
}

const NEW_CHAT_ICON_SIZE = 12;

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
      messages: [] as import("@frontstage/ai").AgentMessage[],
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
        }}
      >
        <Button testid="agent-new" size="small" onClick={handleNew}>
          <span style={{ display: "flex", alignItems: "center", gap: theme.spacing.xxs }}>
            <Icon name="plus" size={NEW_CHAT_ICON_SIZE} />
            New Chat
          </span>
        </Button>
      </div>

      {sessions.length > 0 && (
        <div
          style={{
            overflowY: "auto",
            maxHeight: theme.size.sessionListMax,
            padding: `0 ${theme.spacing.sm} ${theme.spacing.xs}`,
          }}
        >
          <MenuList
            items={sessions.map((entry, i) => ({ id: entry.id, label: entry.title, testid: `agent-session-${i}` }))}
            onSelect={handleSelect}
          />
        </div>
      )}
    </div>
  );
}
