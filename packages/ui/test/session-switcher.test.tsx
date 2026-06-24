import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type MediaManifest,
  type Track,
  type Timeline,
} from "@palmier/core";
import {
  ToolExecutor,
  buildCatalog,
  AgentSession,
  ChatSessionStore,
  type AiGateway,
  type ChatRequest,
  type StreamEvent,
  type AgentSessionDeps,
  type ToolContext,
  type ChatSessionDoc,
} from "@palmier/ai";
import { SessionSwitcher } from "../src/agent/SessionSwitcher.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeClip(id: string, startFrame: number) {
  return {
    id,
    mediaRef: "m1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame,
    durationFrames: 60,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear" as const,
    fadeOutInterpolation: "linear" as const,
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
  };
}

function makeTrack(id = "t1"): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("c1", 0)] };
}

function makeTimeline(): Timeline {
  return { ...defaultTimeline(), tracks: [makeTrack()] };
}

function makeManifest(): MediaManifest {
  return {
    version: 2,
    entries: [{ id: "m1", name: "clip.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/clip.mp4" }, duration: 3 }],
    folders: [],
  };
}

let _id = 0;
function makeCtx(store: EditorStore): ToolContext {
  return { store, getManifest: () => makeManifest(), newId: () => `gen-${++_id}` };
}

class FakeGateway implements AiGateway {
  private queue: StreamEvent[][];
  constructor(turns: StreamEvent[][] = []) { this.queue = [...turns]; }
  async *streamChat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    const events = this.queue.shift();
    if (!events) throw new Error("FakeGateway: no more turns");
    for (const ev of events) yield ev;
  }
  async generateImage() { return { images: [] }; }
}

function makeDeps(store: EditorStore): AgentSessionDeps {
  const tools = buildCatalog();
  const ctx = makeCtx(store);
  return {
    gateway: new FakeGateway(),
    executor: new ToolExecutor(tools, ctx),
    tools,
    model: "test",
    newId: () => `msg-${++_id}`,
    id: `sess-${++_id}`,
    now: () => new Date().toISOString(),
  };
}

// In-memory ProjectStore for ChatSessionStore
function makeMemoryStore() {
  const mem = new Map<string, string>();
  return {
    readText: async (key: string) => mem.get(key) ?? null,
    writeText: async (key: string, value: string) => { mem.set(key, value); },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

test("SessionSwitcher: New Chat resets the session to an empty conversation", async () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps(store));
  const sessionStore = new ChatSessionStore(makeMemoryStore());

  // Pre-load a doc with a message so we can confirm it gets cleared
  const existingDoc: ChatSessionDoc = {
    id: "existing-1",
    title: "Old chat",
    createdAt: new Date().toISOString(),
    messages: [{ id: "m1", role: "user", content: [{ kind: "text", text: "old message" }] }],
  };
  session.loadDoc(existingDoc);
  expect(session.getState().messages).toHaveLength(1);

  render(<SessionSwitcher session={session} sessionStore={sessionStore} />);

  const newBtn = screen.getByTestId("agent-new");
  await act(async () => {
    fireEvent.click(newBtn);
    await new Promise((r) => setTimeout(r, 0));
  });

  // Session should now have no messages
  expect(session.getState().messages).toHaveLength(0);
});

test("SessionSwitcher: list shows saved sessions most-recent-first", async () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps(store));
  const sessionStore = new ChatSessionStore(makeMemoryStore());

  const doc1: ChatSessionDoc = {
    id: "s1",
    title: "First chat",
    createdAt: "2024-01-01T00:00:00Z",
    messages: [],
  };
  const doc2: ChatSessionDoc = {
    id: "s2",
    title: "Second chat",
    createdAt: "2024-01-02T00:00:00Z",
    messages: [],
  };
  await sessionStore.save(doc1);
  await sessionStore.save(doc2);

  render(<SessionSwitcher session={session} sessionStore={sessionStore} />);

  // Wait for the list to populate
  await waitFor(() => {
    expect(screen.queryByTestId("agent-session-0")).not.toBeNull();
  });

  const item0 = screen.getByTestId("agent-session-0");
  const item1 = screen.getByTestId("agent-session-1");

  // Most-recent-first: doc2 saved last → index 0
  expect(item0.textContent).toContain("Second chat");
  expect(item1.textContent).toContain("First chat");
});

test("SessionSwitcher: clicking a session loads it into the current session", async () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps(store));
  const sessionStore = new ChatSessionStore(makeMemoryStore());

  const targetDoc: ChatSessionDoc = {
    id: "target-session",
    title: "Target",
    createdAt: new Date().toISOString(),
    messages: [
      { id: "x1", role: "user", content: [{ kind: "text", text: "hello from target" }] },
    ],
  };
  await sessionStore.save(targetDoc);

  render(<SessionSwitcher session={session} sessionStore={sessionStore} />);

  await waitFor(() => {
    expect(screen.queryByTestId("agent-session-0")).not.toBeNull();
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("agent-session-0"));
    await new Promise((r) => setTimeout(r, 0));
  });

  // Session should now have the target messages
  const msgs = session.getState().messages;
  expect(msgs).toHaveLength(1);
  const block = msgs[0]!.content[0];
  expect(block?.kind === "text" && block.text).toBe("hello from target");
});
