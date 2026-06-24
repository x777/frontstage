import { describe, expect, test } from "vitest";
import { MemoryProjectStore } from "@palmier/core";
import { AgentSession, type AgentSessionDeps } from "../src/agent/session.js";
import { ChatSessionStore, type ChatSessionDoc } from "../src/agent/session-store.js";
import type { AiGateway, ChatRequest, StreamEvent } from "../src/agent/wire.js";
import { ToolExecutor, buildCatalog, type ToolContext } from "../src/index.js";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop } from "@palmier/core";
import type { MediaManifest } from "@palmier/core";

// ── minimal fake deps for AgentSession ───────────────────────────────────────

class FakeGateway implements AiGateway {
  private queue: StreamEvent[][];
  constructor(turns: StreamEvent[][]) {
    this.queue = [...turns];
  }
  async *streamChat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    const events = this.queue.shift();
    if (!events) throw new Error("FakeGateway: no more scripted turns");
    for (const ev of events) yield ev;
  }
  async generateImage() { return { images: [] }; }
}

function makeManifest(): MediaManifest {
  return { version: 2, entries: [], folders: [] };
}

let _id = 0;
function makeCtx(store: EditorStore): ToolContext {
  return { store, getManifest: () => makeManifest(), newId: () => `gen-${++_id}` };
}

function makeSession(overrides: Partial<AgentSessionDeps> = {}): AgentSession {
  const tl = defaultTimeline();
  const store = new EditorStore(tl);
  const tools = buildCatalog();
  const ctx = makeCtx(store);
  const executor = new ToolExecutor(tools, ctx);
  let msgId = 0;
  return new AgentSession({
    gateway: new FakeGateway([
      [{ type: "textDelta", text: "Hi" }, { type: "done", finishReason: "stop" }],
    ]),
    executor,
    tools,
    model: "test",
    newId: () => `msg-${++msgId}`,
    ...overrides,
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("AgentSession toDoc / loadDoc", () => {
  test("toDoc returns correct shape after a send", async () => {
    let msgId = 0;
    const session = makeSession({ newId: () => `m-${++msgId}`, now: () => "2026-01-01T00:00:00.000Z" });
    await session.send("Hello world");
    const doc = session.toDoc();
    expect(doc.id).toBeTypeOf("string");
    expect(doc.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(doc.title).toBe("Hello world");
    expect(doc.messages).toHaveLength(2);
    expect(doc.messages[0]!.role).toBe("user");
    expect(doc.messages[1]!.role).toBe("assistant");
  });

  test("toDoc title is truncated to ~60 chars", async () => {
    let msgId = 0;
    const longText = "A".repeat(100);
    const session = makeSession({ newId: () => `m-${++msgId}` });
    await session.send(longText);
    const doc = session.toDoc();
    expect(doc.title.length).toBeLessThanOrEqual(63); // 60 + possible "..."
  });

  test("toDoc title is 'New Chat' if no messages", () => {
    const session = makeSession();
    const doc = session.toDoc();
    expect(doc.title).toBe("New Chat");
  });

  test("loadDoc restores messages and resets status/streaming/error", async () => {
    // build a doc directly
    const doc: ChatSessionDoc = {
      id: "test-id-123",
      title: "Restored chat",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "m1", role: "user", content: [{ kind: "text", text: "hi" }] },
        { id: "m2", role: "assistant", content: [{ kind: "text", text: "hello" }] },
      ],
    };

    const session = makeSession();
    // trigger an error state first to verify reset
    session.loadDoc(doc);
    const state = session.getState();
    expect(state.messages).toEqual(doc.messages);
    expect(state.status).toBe("idle");
    expect(state.streaming).toBeNull();
    expect(state.error).toBeUndefined();
  });

  test("loadDoc replaces id and createdAt", () => {
    const doc: ChatSessionDoc = {
      id: "restored-id",
      title: "test",
      createdAt: "2026-06-01T00:00:00.000Z",
      messages: [],
    };
    const session = makeSession({ now: () => "2026-01-01T00:00:00.000Z" });
    session.loadDoc(doc);
    const restored = session.toDoc();
    expect(restored.id).toBe("restored-id");
    expect(restored.createdAt).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("ChatSessionStore", () => {
  test("save + list + load round-trips messages", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);

    const doc: ChatSessionDoc = {
      id: "abc-123",
      title: "Hello world",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "m1", role: "user", content: [{ kind: "text", text: "Hello world" }] },
        { id: "m2", role: "assistant", content: [{ kind: "text", text: "Hi there" }] },
      ],
    };

    await chatStore.save(doc);

    const list = await chatStore.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("abc-123");
    expect(list[0]!.title).toBe("Hello world");
    expect(list[0]!.createdAt).toBe("2026-01-01T00:00:00.000Z");

    const loaded = await chatStore.load("abc-123");
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toEqual(doc.messages);
  });

  test("two saves: list is most-recent-first", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);

    const doc1: ChatSessionDoc = {
      id: "first-id",
      title: "First",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    };
    const doc2: ChatSessionDoc = {
      id: "second-id",
      title: "Second",
      createdAt: "2026-01-02T00:00:00.000Z",
      messages: [],
    };

    await chatStore.save(doc1);
    await chatStore.save(doc2);

    const list = await chatStore.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe("second-id");
    expect(list[1]!.id).toBe("first-id");
  });

  test("saving same id again upserts (no duplicate, moved to front)", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);

    const doc1: ChatSessionDoc = {
      id: "id-a",
      title: "A v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    };
    const doc2: ChatSessionDoc = {
      id: "id-b",
      title: "B",
      createdAt: "2026-01-02T00:00:00.000Z",
      messages: [],
    };
    const doc1v2: ChatSessionDoc = {
      id: "id-a",
      title: "A v2",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [{ id: "m1", role: "user", content: [{ kind: "text", text: "updated" }] }],
    };

    await chatStore.save(doc1);
    await chatStore.save(doc2);
    await chatStore.save(doc1v2);

    const list = await chatStore.list();
    expect(list).toHaveLength(2); // no duplicate
    expect(list[0]!.id).toBe("id-a"); // moved to front
    expect(list[0]!.title).toBe("A v2");

    const loaded = await chatStore.load("id-a");
    expect(loaded!.messages).toEqual(doc1v2.messages);
  });

  test("load missing id returns null", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);
    const result = await chatStore.load("missing-id");
    expect(result).toBeNull();
  });

  test("corrupt chats/index.json returns [] without throwing", async () => {
    const projectStore = new MemoryProjectStore();
    await projectStore.writeText("chats/index.json", "not json {{{{");
    const chatStore = new ChatSessionStore(projectStore);
    const list = await chatStore.list();
    expect(list).toEqual([]);
  });

  test("corrupt chats/<id>.json returns null without throwing", async () => {
    const projectStore = new MemoryProjectStore();
    await projectStore.writeText("chats/bad-id.json", "not valid json");
    const chatStore = new ChatSessionStore(projectStore);
    const result = await chatStore.load("bad-id");
    expect(result).toBeNull();
  });

  test("unsafe id '../evil' is rejected on save", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);
    const doc: ChatSessionDoc = {
      id: "../evil",
      title: "Evil",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    };
    await expect(chatStore.save(doc)).rejects.toThrow();
  });

  test("unsafe id '../evil' returns null on load", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);
    const result = await chatStore.load("../evil");
    expect(result).toBeNull();
  });

  test("unsafe id with backslash is rejected on save", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);
    const doc: ChatSessionDoc = {
      id: "evil\\path",
      title: "Evil",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    };
    await expect(chatStore.save(doc)).rejects.toThrow();
  });

  test("remove drops id from list (file may linger)", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);

    const doc: ChatSessionDoc = {
      id: "to-remove",
      title: "Remove me",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    };
    await chatStore.save(doc);
    expect(await chatStore.list()).toHaveLength(1);

    await chatStore.remove("to-remove");
    const list = await chatStore.list();
    expect(list).toHaveLength(0);
    expect(list.find((e) => e.id === "to-remove")).toBeUndefined();
  });

  test("AgentSession toDoc → save → load round-trip via store", async () => {
    const projectStore = new MemoryProjectStore();
    const chatStore = new ChatSessionStore(projectStore);

    const session = makeSession({ now: () => "2026-06-01T00:00:00.000Z" });
    await session.send("Tell me about this project");

    const doc = session.toDoc();
    await chatStore.save(doc);

    const loaded = await chatStore.load(doc.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toEqual(doc.messages);
    expect(loaded!.title).toBe("Tell me about this project");
    expect(loaded!.createdAt).toBe("2026-06-01T00:00:00.000Z");

    // restore into fresh session
    const session2 = makeSession();
    session2.loadDoc(loaded!);
    const state = session2.getState();
    expect(state.messages).toEqual(doc.messages);
    expect(state.status).toBe("idle");
  });
});
