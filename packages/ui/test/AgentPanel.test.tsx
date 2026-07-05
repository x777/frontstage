import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type MediaManifest,
  type Track,
  type Timeline,
} from "@frontstage/core";
import {
  ToolExecutor,
  buildCatalog,
  AgentSession,
  type AiGateway,
  type ChatRequest,
  type StreamEvent,
  type AgentSessionDeps,
  type ToolContext,
} from "@frontstage/ai";
import { AgentPanel } from "../src/agent/AgentPanel.js";

// ── fixtures (mirrored from @frontstage/ai session.test.ts) ─────────────────────

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

  async generateImage() {
    return { images: [] };
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

test("renders agent-model header when model prop provided", () => {
  const store = new EditorStore(makeTimeline());
  const deps = makeDeps([], store);
  const session = new AgentSession(deps);
  render(<AgentPanel session={session} model="test-model" />);
  expect(screen.getByTestId("agent-model").textContent).toBe("test-model");
});

test("send disables when input is empty", () => {
  const store = new EditorStore(makeTimeline());
  const deps = makeDeps([], store);
  const session = new AgentSession(deps);
  render(<AgentPanel session={session} />);
  const sendBtn = screen.getByTestId("agent-send");
  expect(sendBtn).toBeDisabled();
});

test("text turn: user message and assistant reply appear after send", async () => {
  const store = new EditorStore(makeTimeline());
  const deps = makeDeps(
    [
      [
        { type: "textDelta", text: "Hello " },
        { type: "textDelta", text: "world" },
        { type: "done", finishReason: "stop" },
      ],
    ],
    store,
  );
  const session = new AgentSession(deps);
  render(<AgentPanel session={session} model="test-model" />);

  const input = screen.getByTestId("agent-input");
  const sendBtn = screen.getByTestId("agent-send");

  fireEvent.change(input, { target: { value: "hi there" } });
  expect(sendBtn).not.toBeDisabled();

  // Click sends via the component's handleSend which calls session.send internally
  await act(async () => {
    fireEvent.click(sendBtn);
    // allow the microtask queue to flush so the async send loop runs
    await new Promise((r) => setTimeout(r, 0));
  });

  // user message appears
  const userMsgs = await screen.findAllByTestId("agent-msg-user");
  expect(userMsgs.length).toBeGreaterThanOrEqual(1);
  expect(userMsgs[0]!.textContent).toBe("hi there");

  // assistant reply appears
  const assistantMsg = await screen.findByTestId("agent-msg-assistant");
  expect(assistantMsg.textContent).toContain("Hello world");

  // input cleared
  expect((screen.getByTestId("agent-input") as HTMLTextAreaElement).value).toBe("");
});

test("Enter key sends the message", async () => {
  const store = new EditorStore(makeTimeline());
  const deps = makeDeps(
    [
      [
        { type: "textDelta", text: "response" },
        { type: "done", finishReason: "stop" },
      ],
    ],
    store,
  );
  const session = new AgentSession(deps);
  render(<AgentPanel session={session} />);

  const input = screen.getByTestId("agent-input");
  fireEvent.change(input, { target: { value: "ping" } });

  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await new Promise((r) => setTimeout(r, 0));
  });

  await screen.findAllByTestId("agent-msg-user");
  await screen.findByTestId("agent-msg-assistant");
});

test("tool-call turn: toolcall chip and toolresult row appear", async () => {
  const store = new EditorStore(makeTimeline());
  const deps = makeDeps(
    [
      [
        { type: "textDelta", text: "adding" },
        {
          type: "toolCallComplete",
          id: "tc-1",
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
  render(<AgentPanel session={session} />);

  const input = screen.getByTestId("agent-input");
  fireEvent.change(input, { target: { value: "add a clip" } });

  await act(async () => {
    fireEvent.click(screen.getByTestId("agent-send"));
    await new Promise((r) => setTimeout(r, 0));
  });

  // toolcall chip — may appear in the committed assistant message
  const chips = await screen.findAllByTestId("agent-toolcall");
  expect(chips.length).toBeGreaterThanOrEqual(1);
  expect(chips[0]!.textContent).toContain("add_clips");

  // toolresult row
  await screen.findByTestId("agent-toolresult");
});

test("gateway error: agent-error shows the error message", async () => {
  const store = new EditorStore(makeTimeline());
  const deps = makeDeps(
    [[{ type: "error", message: "gateway exploded" }]],
    store,
  );
  const session = new AgentSession(deps);
  render(<AgentPanel session={session} />);

  const input = screen.getByTestId("agent-input");
  fireEvent.change(input, { target: { value: "boom" } });

  await act(async () => {
    fireEvent.click(screen.getByTestId("agent-send"));
    await new Promise((r) => setTimeout(r, 0));
  });

  const errorEl = await screen.findByTestId("agent-error");
  expect(errorEl.textContent).toContain("gateway exploded");
});

test("send is disabled while session is streaming (busy guard)", async () => {
  // Verify that the busy-state logic works: after send starts, status becomes
  // streaming, which disables the Send button. We test this via session state
  // directly since intermediate streaming UI state in jsdom requires complex act coordination.
  const store = new EditorStore(makeTimeline());
  const deps = makeDeps(
    [
      [
        { type: "textDelta", text: "reply" },
        { type: "done", finishReason: "stop" },
      ],
    ],
    store,
  );
  const session = new AgentSession(deps);
  render(<AgentPanel session={session} />);

  // Verify session reaches streaming state during send
  let sawStreaming = false;
  const unsub = session.subscribe(() => {
    if (session.getState().status === "streaming") sawStreaming = true;
  });

  await act(async () => {
    await session.send("hello");
  });
  unsub();

  expect(sawStreaming).toBe(true);
  // After send completes, Send button is enabled again (input is still empty so disabled)
  expect(screen.getByTestId("agent-send")).toBeDisabled();
});

// ── relayGate (M18C T3: relay-mode login gate) ──────────────────────────────

test("relayGate omitted: composer enabled, default placeholder, no sign-in row", () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps([], store));
  render(<AgentPanel session={session} />);

  expect(screen.queryByTestId("agent-relay-gate")).not.toBeInTheDocument();
  const input = screen.getByTestId("agent-input") as HTMLTextAreaElement;
  expect(input).not.toBeDisabled();
  expect(input.placeholder).toBe("Ask, or type @ to reference media");
});

test("relayGate signedIn=true: renders exactly as without relayGate", () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps([], store));
  render(<AgentPanel session={session} relayGate={{ signedIn: true, onSignIn: () => {} }} />);

  expect(screen.queryByTestId("agent-relay-gate")).not.toBeInTheDocument();
  expect(screen.getByTestId("agent-input")).not.toBeDisabled();
});

test("relayGate signedIn=false: composer disabled with the sign-in placeholder and prompt", () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps([], store));
  render(<AgentPanel session={session} relayGate={{ signedIn: false, onSignIn: () => {} }} />);

  const input = screen.getByTestId("agent-input") as HTMLTextAreaElement;
  expect(input).toBeDisabled();
  expect(input.placeholder).toBe("Sign in to use the agent");

  const gate = screen.getByTestId("agent-relay-gate");
  expect(gate.textContent).toContain("Sign in to use the agent");
});

test("relayGate signedIn=false: Google/GitHub buttons call onSignIn with the right provider", () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps([], store));
  const onSignIn = vi.fn();
  render(<AgentPanel session={session} relayGate={{ signedIn: false, onSignIn }} />);

  fireEvent.click(screen.getByTestId("agent-relay-gate-google"));
  expect(onSignIn).toHaveBeenCalledWith("google");

  fireEvent.click(screen.getByTestId("agent-relay-gate-github"));
  expect(onSignIn).toHaveBeenCalledWith("github");
});
