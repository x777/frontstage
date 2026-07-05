/**
 * Tests for the toggleable agent rail in Layout + the agent? prop on Editor.
 *
 * Approach: Full <Editor> RTL is impractical in jsdom — PreviewPanel mounts a
 * WebGPU canvas via PlaybackEngine.create() which throws "WebGPU not supported".
 * We mock PreviewPanel + TimelinePanel (canvas) + MediaPanel (drop observer) at
 * the module level so the Editor shell can render.  Layout tests are unmocked
 * and exercise the agent rail directly.
 */

import { vi } from "vitest";

// Mock canvas-heavy panels BEFORE any imports that pull them in
vi.mock("../src/preview/PreviewPanel.js", () => ({
  PreviewPanel: () => <div data-testid="stub-preview" />,
}));
vi.mock("../src/timeline/TimelinePanel.js", () => ({
  TimelinePanel: () => <div data-testid="stub-timeline" />,
}));
vi.mock("../src/media/MediaPanel.js", () => ({
  MediaPanel: () => <div data-testid="stub-media" />,
}));

import { render, screen, fireEvent } from "@testing-library/react";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type MediaManifest,
  type Track,
  type Timeline,
  type ProjectSession,
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
import { Layout } from "../src/layout/Layout.js";
import { Editor } from "../src/editor/Editor.js";

// ── helpers (mirrored from AgentPanel.test.tsx) ────────────────────────────

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
  constructor(turns: StreamEvent[][] = []) { this.queue = [...turns]; }
  async *streamChat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    const events = this.queue.shift();
    if (!events) throw new Error("FakeGateway: no more scripted turns");
    for (const ev of events) yield ev;
  }
  async generateImage() { return { images: [] }; }
}

function makeDeps(store: EditorStore, overrides: Partial<AgentSessionDeps> = {}): AgentSessionDeps {
  const tools = buildCatalog();
  const ctx = makeCtx(store);
  const executor = new ToolExecutor(tools, ctx);
  return {
    gateway: new FakeGateway(),
    executor,
    tools,
    model: "test-model",
    newId: () => `msg-${++_idCounter}`,
    ...overrides,
  };
}

// Minimal stubs for Layout required slots
const stubNode = <div data-testid="stub" />;
function makeStore() { return new EditorStore(makeTimeline()); }

// Minimal stubs to render Editor without a real media/library/canvas
function makeMinimalEditorProps() {
  const store = makeStore();
  const media = {} as import("@frontstage/engine").MediaByteSource;
  const library: import("../src/editor/Editor.js").EditorLibrary = {
    getSnapshot: () => ({ entries: [], folders: [] }),
    subscribe: () => () => {},
    thumbnail: () => undefined,
    importFiles: async () => [],
    entry: () => undefined,
    createFolder: () => ({ id: "f", name: "New Folder" }),
    renameFolder: () => {},
    deleteFolders: () => ({ removedAssetIds: [] }),
    moveEntriesToFolder: () => {},
    moveFolderToFolder: () => {},
  };
  return { store, media, library };
}

// ── Layout agent rail tests ────────────────────────────────────────────────

test("Layout: panel-agent shown when agent + agentVisible=true", () => {
  const store = makeStore();
  render(
    <Layout
      store={store}
      media={stubNode}
      preview={stubNode}
      timeline={stubNode}
      inspector={stubNode}
      agent={<div data-testid="x-content" />}
      agentVisible={true}
    />,
  );
  expect(screen.getByTestId("panel-agent")).toBeInTheDocument();
  expect(screen.getByTestId("x-content")).toBeInTheDocument();
});

test("Layout: panel-agent absent when agentVisible=false", () => {
  const store = makeStore();
  render(
    <Layout
      store={store}
      media={stubNode}
      preview={stubNode}
      timeline={stubNode}
      inspector={stubNode}
      agent={<div data-testid="x-content" />}
      agentVisible={false}
    />,
  );
  expect(screen.queryByTestId("panel-agent")).not.toBeInTheDocument();
});

test("Layout: panel-agent absent when agent prop omitted", () => {
  const store = makeStore();
  render(
    <Layout
      store={store}
      media={stubNode}
      preview={stubNode}
      timeline={stubNode}
      inspector={stubNode}
      agentVisible={true}
    />,
  );
  expect(screen.queryByTestId("panel-agent")).not.toBeInTheDocument();
});

test("Layout: topBarTrailing renders alongside the title, absent by default", () => {
  const store = makeStore();
  const { rerender } = render(
    <Layout store={store} media={stubNode} preview={stubNode} timeline={stubNode} inspector={stubNode} title="Untitled" />,
  );
  expect(screen.getByTestId("top-bar-title")).toBeInTheDocument();
  expect(screen.queryByTestId("trailing-content")).not.toBeInTheDocument();

  rerender(
    <Layout
      store={store}
      media={stubNode}
      preview={stubNode}
      timeline={stubNode}
      inspector={stubNode}
      title="Untitled"
      topBarTrailing={<div data-testid="trailing-content">Sign in</div>}
    />,
  );
  expect(screen.getByTestId("trailing-content")).toBeInTheDocument();
});

test("Layout: existing panels (media/preview/timeline/inspector) unchanged when agent present", () => {
  const store = makeStore();
  render(
    <Layout
      store={store}
      media={<div data-testid="m" />}
      preview={<div data-testid="p" />}
      timeline={<div data-testid="tl" />}
      inspector={<div data-testid="ins" />}
      agent={<div data-testid="ag" />}
      agentVisible={true}
    />,
  );
  expect(screen.getByTestId("panel-media")).toBeInTheDocument();
  expect(screen.getByTestId("panel-preview")).toBeInTheDocument();
  expect(screen.getByTestId("panel-timeline")).toBeInTheDocument();
  expect(screen.getByTestId("panel-inspector")).toBeInTheDocument();
  expect(screen.getByTestId("panel-agent")).toBeInTheDocument();
});

// ── Editor agent prop / toggle tests ──────────────────────────────────────

test("Editor: agent-toggle present when agent prop supplied", () => {
  const { store, media, library } = makeMinimalEditorProps();
  const agentSession = new AgentSession(makeDeps(makeStore()));

  render(
    <Editor
      store={store}
      media={media}
      library={library}
      agent={{ session: agentSession, model: "test-model" }}
    />,
  );

  expect(screen.getByTestId("agent-toggle")).toBeInTheDocument();
});

test("Editor: no agent-toggle when agent prop omitted", () => {
  const { store, media, library } = makeMinimalEditorProps();

  render(
    <Editor
      store={store}
      media={media}
      library={library}
    />,
  );

  expect(screen.queryByTestId("agent-toggle")).not.toBeInTheDocument();
});

test("Editor: clicking agent-toggle toggles panel-agent visibility", () => {
  const { store, media, library } = makeMinimalEditorProps();
  const agentSession = new AgentSession(makeDeps(makeStore()));

  render(
    <Editor
      store={store}
      media={media}
      library={library}
      agent={{ session: agentSession, model: "test-model" }}
    />,
  );

  // Initially hidden (agentVisible defaults to false unless localStorage has "1")
  expect(screen.queryByTestId("panel-agent")).not.toBeInTheDocument();

  // Click toggle → show
  fireEvent.click(screen.getByTestId("agent-toggle"));
  expect(screen.getByTestId("panel-agent")).toBeInTheDocument();

  // Click again → hide
  fireEvent.click(screen.getByTestId("agent-toggle"));
  expect(screen.queryByTestId("panel-agent")).not.toBeInTheDocument();
});

test("Editor: no panel-agent when agent prop omitted (apps/web regression)", () => {
  const { store, media, library } = makeMinimalEditorProps();

  render(
    <Editor
      store={store}
      media={media}
      library={library}
    />,
  );

  expect(screen.queryByTestId("panel-agent")).not.toBeInTheDocument();
});

// ── nativeFileMenu gating (desktop macOS uses the native global menu) ────────

function makeFakeSession(): ProjectSession {
  return {
    getState: () => ({ name: "Untitled" }),
    subscribe: () => () => {},
    isDirty: () => false,
    listRecent: async () => [],
  } as unknown as ProjectSession;
}

test("Editor: in-app FileMenu shown with session (web / non-macOS desktop)", () => {
  const { store, media, library } = makeMinimalEditorProps();

  render(
    <Editor store={store} media={media} library={library} session={makeFakeSession()} />,
  );

  expect(screen.getByTestId("file-menu")).toBeInTheDocument();
});

test("Editor: in-app FileMenu hidden when nativeFileMenu (desktop macOS native menu)", () => {
  const { store, media, library } = makeMinimalEditorProps();

  render(
    <Editor
      store={store}
      media={media}
      library={library}
      session={makeFakeSession()}
      nativeFileMenu
    />,
  );

  expect(screen.queryByTestId("file-menu")).not.toBeInTheDocument();
});

// ── relayAuth (M18C T3: visible sign-in, relay-mode only) ───────────────────

test("Editor: no relay-auth control when relayAuth prop omitted (desktop/web-proxy unaffected)", () => {
  const { store, media, library } = makeMinimalEditorProps();

  render(<Editor store={store} media={media} library={library} session={makeFakeSession()} />);

  expect(screen.queryByTestId("relay-auth-signin")).not.toBeInTheDocument();
  expect(screen.queryByTestId("relay-auth-user")).not.toBeInTheDocument();
});

test("Editor: relayAuth signed out shows Sign in in the top bar; picking Google calls onSignIn", () => {
  const { store, media, library } = makeMinimalEditorProps();
  const onSignIn = vi.fn();

  render(
    <Editor
      store={store}
      media={media}
      library={library}
      session={makeFakeSession()}
      relayAuth={{ user: null, onSignIn }}
    />,
  );

  expect(screen.getByTestId("relay-auth-signin")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("relay-auth-signin"));
  fireEvent.click(screen.getByTestId("relay-auth-signin-google"));
  expect(onSignIn).toHaveBeenCalledWith("google");
});

test("Editor: relayAuth signed in shows the user's name; clicking it opens Settings", () => {
  const { store, media, library } = makeMinimalEditorProps();
  const agentSession = new AgentSession(makeDeps(makeStore()));

  render(
    <Editor
      store={store}
      media={media}
      library={library}
      session={makeFakeSession()}
      relayAuth={{ user: { name: "Ada Lovelace", provider: "google" }, onSignIn: () => {} }}
      agent={{
        session: agentSession,
        model: "test-model",
        settings: {
          keyConfig: { kind: "proxy", proxyUrl: "http://localhost:8787", onSave: () => {} },
          llmModels: [],
          imageModels: [],
          agentModel: "test-model",
          imageModel: "test-model",
          onAgentModelChange: () => {},
          onImageModelChange: () => {},
          confirmThreshold: 50,
          onConfirmThresholdChange: () => {},
        },
      }}
    />,
  );

  expect(screen.queryByTestId("settings-panel")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("relay-auth-user"));
  expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
});
