import type { AgentMessage } from "./conversation.js";
import type { ProjectStore } from "@frontstage/core";

export interface ChatSessionDoc {
  id: string;
  title: string;
  createdAt: string;
  messages: AgentMessage[];
}

export interface ChatSessionIndexEntry {
  id: string;
  title: string;
  createdAt: string;
}

function isSafeId(id: string): boolean {
  // must be non-empty and contain no path separators or traversal sequences
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return false;
  return true;
}

export class ChatSessionStore {
  private readonly store: ProjectStore;

  constructor(store: ProjectStore) {
    this.store = store;
  }

  async list(): Promise<ChatSessionIndexEntry[]> {
    try {
      const raw = await this.store.readText("chats/index.json");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e): e is ChatSessionIndexEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof e.id === "string" &&
          typeof e.title === "string" &&
          typeof e.createdAt === "string",
      );
    } catch {
      return [];
    }
  }

  async save(doc: ChatSessionDoc): Promise<void> {
    if (!isSafeId(doc.id)) throw new Error(`Unsafe session id: ${doc.id}`);
    await this.store.writeText(`chats/${doc.id}.json`, JSON.stringify(doc));
    const current = await this.list();
    const filtered = current.filter((e) => e.id !== doc.id);
    const entry: ChatSessionIndexEntry = { id: doc.id, title: doc.title, createdAt: doc.createdAt };
    const updated = [entry, ...filtered];
    await this.store.writeText("chats/index.json", JSON.stringify(updated));
  }

  async load(id: string): Promise<ChatSessionDoc | null> {
    if (!isSafeId(id)) return null;
    try {
      const raw = await this.store.readText(`chats/${id}.json`);
      if (!raw) return null;
      return JSON.parse(raw) as ChatSessionDoc;
    } catch {
      return null;
    }
  }

  // Drops the id from the index; the per-session file is left in place.
  async remove(id: string): Promise<void> {
    const current = await this.list();
    const updated = current.filter((e) => e.id !== id);
    await this.store.writeText("chats/index.json", JSON.stringify(updated));
  }
}
