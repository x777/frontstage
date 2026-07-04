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
  toWireMessages,
  DEFAULT_SYSTEM_PROMPT,
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
  readonly capturedModels: string[] = [];
  readonly capturedSystems: string[] = [];

  constructor(turns: StreamEvent[][]) {
    this.queue = [...turns];
  }

  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    this.capturedModels.push(req.model);
    this.capturedSystems.push(req.system);
    const events = this.queue.shift();
    if (!events) throw new Error("FakeGateway: no more scripted turns");
    for (const ev of events) {
      yield ev;
    }
  }

  async generateImage() { return { images: [] }; }
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

  test("orphan resolution: loadDoc with orphaned toolCall gets resolved before next send", async () => {
    const store = new EditorStore(makeTimeline());
    // Build a doc whose last message is an assistant with an orphaned toolCall (no following tool result)
    const orphanDoc = {
      id: "sess-orphan",
      title: "Orphan test",
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: "m1",
          role: "user" as const,
          content: [{ kind: "text" as const, text: "do something" }],
        },
        {
          id: "m2",
          role: "assistant" as const,
          content: [
            {
              kind: "toolCall" as const,
              id: "orphan-call-1",
              name: "add_clips",
              argsJson: "{}",
            },
          ],
        },
        // no tool result message — this is the orphan
      ],
    };

    const deps = makeDeps(
      [
        // After resolving the orphan, session sends the new user turn; gateway returns simple stop
        [
          { type: "textDelta", text: "done" },
          { type: "done", finishReason: "stop" },
        ],
      ],
      store,
    );
    const session = new AgentSession(deps);
    session.loadDoc(orphanDoc);

    await session.send("continue");

    const state = session.getState();
    expect(state.status).toBe("idle");

    // A tool message for the orphan should now exist
    const toolMsg = state.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const resultBlock = toolMsg!.content.find(
      (b) => b.kind === "toolResult" && b.toolCallId === "orphan-call-1",
    );
    expect(resultBlock).toBeDefined();
    expect((resultBlock as { kind: "toolResult"; isError: boolean }).isError).toBe(true);

    // toWireMessages must produce a valid OpenAI sequence: every tool_calls[].id has a matching role:"tool" tool_call_id
    const wire = toWireMessages(state.messages);
    const toolCallIds = wire
      .filter((m) => m.role === "assistant" && m.tool_calls)
      .flatMap((m) => (m.tool_calls ?? []).map((tc) => tc.id));
    const toolResultIds = wire.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
    for (const id of toolCallIds) {
      expect(toolResultIds).toContain(id);
    }
  });

  test("setModel: live switch — next send uses new model", async () => {
    const store = new EditorStore(makeTimeline());
    const simpleStop: StreamEvent[] = [
      { type: "textDelta", text: "ok" },
      { type: "done", finishReason: "stop" },
    ];
    const fakeGateway = new FakeGateway([simpleStop, simpleStop]);
    const tools = buildCatalog();
    const ctx = makeCtx(store);
    const executor = new ToolExecutor(tools, ctx);
    const session = new AgentSession({
      gateway: fakeGateway,
      executor,
      tools,
      model: "m1",
      newId: () => `msg-${++_idCounter}`,
    });

    await session.send("first");
    expect(fakeGateway.capturedModels[0]).toBe("m1");

    session.setModel("m2");
    await session.send("second");
    expect(fakeGateway.capturedModels[1]).toBe("m2");
  });

  test("loadDoc resets cancelled: cancelled session resumes after loadDoc", async () => {
    const store = new EditorStore(makeTimeline());
    const deps = makeDeps(
      [
        // First send (before cancel) — gateway is never consumed because we cancel immediately
        // Second send after loadDoc — must succeed
        [
          { type: "textDelta", text: "hello after reload" },
          { type: "done", finishReason: "stop" },
        ],
      ],
      store,
    );
    const session = new AgentSession(deps);

    // Cancel the session before any send (simulates a cancel that stuck)
    session.cancel();

    // loadDoc a fresh doc — this should reset cancelled
    const freshDoc = {
      id: "sess-fresh",
      title: "Fresh",
      createdAt: new Date().toISOString(),
      messages: [],
    };
    session.loadDoc(freshDoc);

    // send should NOT be stuck — the loop should run and produce an assistant reply
    await session.send("hi");
    const state = session.getState();
    expect(state.status).toBe("idle");
    const assistantMsg = state.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const textBlock = assistantMsg!.content.find((b) => b.kind === "text");
    expect((textBlock as { kind: "text"; text: string }).text).toBe("hello after reload");
  });

  // M15 T1's digest seam: getSkillsSuffix is the injection point T2's hosts wire to
  // `async () => { await store.reload(); return skillsSection(store.skillIndex); }`.
  describe("getSkillsSuffix — the skills digest seam", () => {
    test("absent -> system prompt unchanged (today's behavior)", async () => {
      const store = new EditorStore(makeTimeline());
      const simpleStop: StreamEvent[] = [{ type: "textDelta", text: "ok" }, { type: "done", finishReason: "stop" }];
      const gateway = new FakeGateway([simpleStop]);
      const deps = makeDeps([simpleStop], store, { gateway });
      const session = new AgentSession(deps);
      await session.send("hi");
      expect(gateway.capturedSystems[0]).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    test("present -> called once per send() and its result appended to every turn's system prompt", async () => {
      const store = new EditorStore(makeTimeline());
      const toolTurn: StreamEvent[] = [
        { type: "toolCallComplete", id: "c1", name: "get_timeline", args: {} },
        { type: "done", finishReason: "tool_calls" },
      ];
      const finalTurn: StreamEvent[] = [{ type: "textDelta", text: "done" }, { type: "done", finishReason: "stop" }];
      const gateway = new FakeGateway([toolTurn, finalTurn]);
      let calls = 0;
      const getSkillsSuffix = async () => {
        calls++;
        return "\n# Skills\n- foo: does foo";
      };
      const deps = makeDeps([toolTurn, finalTurn], store, { gateway, getSkillsSuffix });
      const session = new AgentSession(deps);
      await session.send("go");

      expect(calls).toBe(1);
      expect(gateway.capturedSystems).toHaveLength(2);
      for (const system of gateway.capturedSystems) {
        expect(system).toBe(DEFAULT_SYSTEM_PROMPT + "\n# Skills\n- foo: does foo");
      }
    });

    test("a fresh suffix is recomputed on the NEXT send() (per-run reload semantics)", async () => {
      const store = new EditorStore(makeTimeline());
      const stop: StreamEvent[] = [{ type: "textDelta", text: "ok" }, { type: "done", finishReason: "stop" }];
      const gateway = new FakeGateway([stop, stop]);
      let index = "- a: first";
      const getSkillsSuffix = async () => `\n# Skills\n${index}`;
      const deps = makeDeps([stop, stop], store, { gateway, getSkillsSuffix });
      const session = new AgentSession(deps);

      await session.send("first");
      index = "- a: first\n- b: second";
      await session.send("second");

      expect(gateway.capturedSystems[0]).toContain("- a: first");
      expect(gateway.capturedSystems[0]).not.toContain("- b: second");
      expect(gateway.capturedSystems[1]).toContain("- b: second");
    });
  });
});
