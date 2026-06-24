import { describe, expect, test, vi } from "vitest";
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
  type AiGateway,
  type ChatRequest,
  type StreamEvent,
  type ToolContext,
  AgentSession,
  type AgentSessionDeps,
} from "../src/index.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeClip(id: string, startFrame: number, durationFrames = 60) {
  return {
    id,
    mediaRef: "media-1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame,
    durationFrames,
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

function makeTrack(id = "t1", clips = [makeClip("c1", 0)]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function makeTimeline(): Timeline {
  return { ...defaultTimeline(), tracks: [makeTrack()] };
}

function makeManifest(): MediaManifest {
  return {
    version: 2,
    entries: [
      {
        id: "media-1",
        name: "sunrise.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/sunrise.mp4" },
        duration: 2,
      },
      {
        id: "media-2",
        name: "ocean.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/ocean.mp4" },
        duration: 3,
      },
    ],
    folders: [],
  };
}

let _idCounter = 0;
function makeCtx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: () => makeManifest(),
    newId: () => `gen-${++_idCounter}`,
  };
}

// ── fake gateway ──────────────────────────────────────────────────────────────

class FakeGateway implements AiGateway {
  private queue: StreamEvent[][];

  constructor(turns: StreamEvent[][]) {
    this.queue = [...turns];
  }

  async *streamChat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    const events = this.queue.shift();
    if (!events) throw new Error("FakeGateway: no more scripted turns");
    for (const ev of events) {
      yield ev;
    }
  }
}

function makeDeps(
  turns: StreamEvent[][],
  store: EditorStore,
  overrides: Partial<AgentSessionDeps> = {},
): AgentSessionDeps {
  const tools = buildCatalog();
  const ctx = makeCtx(store);
  const executor = new ToolExecutor(tools, ctx);
  return {
    gateway: new FakeGateway(turns),
    executor,
    tools,
    model: "test-model",
    newId: () => `msg-${++_idCounter}`,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("AgentSession", () => {
  test("text-only turn: correct messages and idle status", async () => {
    const store = new EditorStore(makeTimeline());
    const deps = makeDeps(
      [
        [
          { type: "textDelta", text: "Hi " },
          { type: "textDelta", text: "there" },
          { type: "done", finishReason: "stop" },
        ],
      ],
      store,
    );
    const session = new AgentSession(deps);
    await session.send("hello");
    const state = session.getState();
    expect(state.status).toBe("idle");
    expect(state.streaming).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]!.role).toBe("user");
    expect(state.messages[1]!.role).toBe("assistant");
    const assistantBlocks = state.messages[1]!.content;
    const textBlock = assistantBlocks.find((b) => b.kind === "text");
    expect(textBlock).toBeDefined();
    expect((textBlock as { kind: "text"; text: string }).text).toBe("Hi there");
    // no tool ran, store untouched
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(1);
  });

  test("tool turn mutates the store and produces correct conversation", async () => {
    const store = new EditorStore(makeTimeline());
    const deps = makeDeps(
      [
        [
          { type: "textDelta", text: "adding" },
          {
            type: "toolCallComplete",
            id: "c1",
            name: "add_clips",
            args: { clips: [{ mediaId: "media-1", trackIndex: 0, startFrame: 30 }] },
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        [
          { type: "textDelta", text: "done" },
          { type: "done", finishReason: "stop" },
        ],
      ],
      store,
    );
    const session = new AgentSession(deps);
    await session.send("add a clip");

    // store MUTATED
    const tl = store.getSnapshot().timeline;
    const addedClip = tl.tracks[0]!.clips.find((c) => c.startFrame === 30);
    expect(addedClip).toBeDefined();

    // conversation: user → assistant(toolCall) → tool(result) → assistant(text)
    const state = session.getState();
    expect(state.status).toBe("idle");
    expect(state.messages).toHaveLength(4);
    expect(state.messages[0]!.role).toBe("user");
    expect(state.messages[1]!.role).toBe("assistant");
    const toolCallBlock = state.messages[1]!.content.find((b) => b.kind === "toolCall");
    expect(toolCallBlock).toBeDefined();
    expect(state.messages[2]!.role).toBe("tool");
    const toolResultBlock = state.messages[2]!.content.find((b) => b.kind === "toolResult");
    expect(toolResultBlock).toBeDefined();
    expect((toolResultBlock as { kind: "toolResult"; isError: boolean }).isError).toBe(false);
    expect(state.messages[3]!.role).toBe("assistant");
    const finalText = state.messages[3]!.content.find((b) => b.kind === "text");
    expect((finalText as { kind: "text"; text: string }).text).toBe("done");
  });

  test("{} args graceful: isError:true in tool result, send resolves, no throw", async () => {
    const store = new EditorStore(makeTimeline());
    const deps = makeDeps(
      [
        [
          {
            type: "toolCallComplete",
            id: "c1",
            name: "add_clips",
            args: {},
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        [
          { type: "done", finishReason: "stop" },
        ],
      ],
      store,
    );
    const session = new AgentSession(deps);
    // must not throw
    await expect(session.send("bad args")).resolves.toBeUndefined();
    const state = session.getState();
    expect(state.status).toBe("idle");
    const toolMsg = state.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const resultBlock = toolMsg!.content.find((b) => b.kind === "toolResult");
    expect((resultBlock as { kind: "toolResult"; isError: boolean }).isError).toBe(true);
  });

  test("gateway error: status:error, error string set, send resolves", async () => {
    const store = new EditorStore(makeTimeline());
    const deps = makeDeps(
      [
        [{ type: "error", message: "boom" }],
      ],
      store,
    );
    const session = new AgentSession(deps);
    await expect(session.send("hello")).resolves.toBeUndefined();
    const state = session.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("boom");
  });

  test("subscribe fires during streaming with non-null streaming draft", async () => {
    const store = new EditorStore(makeTimeline());
    const deps = makeDeps(
      [
        [
          { type: "textDelta", text: "hello" },
          { type: "done", finishReason: "stop" },
        ],
      ],
      store,
    );
    const session = new AgentSession(deps);
    let sawNonNullStreaming = false;
    const unsub = session.subscribe(() => {
      const state = session.getState();
      if (state.streaming !== null) sawNonNullStreaming = true;
    });
    await session.send("hi");
    unsub();
    expect(sawNonNullStreaming).toBe(true);
  });

  test("cancel stops further turns", async () => {
    const store = new EditorStore(makeTimeline());
    // gateway would provide infinite tool-call turns, but we cancel after first turn
    const infiniteTurns: StreamEvent[][] = Array.from({ length: 50 }, () => [
      {
        type: "toolCallComplete",
        id: "cx",
        name: "add_clips",
        args: { clips: [{ mediaId: "media-1", trackIndex: 0, startFrame: 30 }] },
      },
      { type: "done", finishReason: "tool_calls" },
    ]);
    const deps = makeDeps(infiniteTurns, store);
    const session = new AgentSession(deps);
    let cancelled = false;
    const unsub = session.subscribe(() => {
      const state = session.getState();
      if (state.status === "tools" && !cancelled) {
        cancelled = true;
        session.cancel();
      }
    });
    await session.send("go");
    unsub();
    const state = session.getState();
    // should have stopped, not reached maxTurns error
    expect(state.status).toBe("idle");
  });

  test("maxTurns: stops with error after maxTurns exceeded", async () => {
    const store = new EditorStore(makeTimeline());
    // always returns a valid tool call so loop would run forever
    const infiniteTurns: StreamEvent[][] = Array.from({ length: 50 }, () => [
      {
        type: "toolCallComplete",
        id: "cx",
        name: "add_clips",
        args: { clips: [{ mediaId: "media-1", trackIndex: 0, startFrame: 30 }] },
      },
      { type: "done", finishReason: "tool_calls" },
    ]);
    const deps = makeDeps(infiniteTurns, store, { maxTurns: 3 });
    const session = new AgentSession(deps);
    await session.send("go");
    const state = session.getState();
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/max turns/i);
  });
});
