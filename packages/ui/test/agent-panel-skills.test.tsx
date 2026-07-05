/**
 * Tests for the "View Skills" book button in the agent chat panel's header row (M15 T3),
 * both as an AgentPanel unit (onOpenSkills prop) and wired end-to-end through Editor into the
 * settings surface's Skills section — mirrors editor-agent.test.tsx's mocking approach (jsdom
 * can't render the WebGPU preview/canvas panels).
 */

import { vi } from "vitest";

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
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, type Track, type Timeline } from "@frontstage/core";
import {
  ToolExecutor,
  buildCatalog,
  AgentSession,
  SkillStore,
  SkillCatalog,
  type AiGateway,
  type ChatRequest,
  type StreamEvent,
  type AgentSessionDeps,
  type ToolContext,
  type SkillStorage,
  type SkillCatalogDeps,
  type ModelEntry,
} from "@frontstage/ai";
import { AgentPanel } from "../src/agent/AgentPanel.js";
import { Editor } from "../src/editor/Editor.js";

// ── AgentPanel unit tests ───────────────────────────────────────────────────

function makeClip(id: string, startFrame: number, durationFrames = 60) {
  return {
    id, mediaRef: "media-1", mediaType: "video" as const, sourceClipType: "video" as const,
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0, speed: 1, volume: 1,
    fadeInFrames: 0, fadeOutFrames: 0, fadeInInterpolation: "linear" as const, fadeOutInterpolation: "linear" as const,
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(),
  };
}
function makeTrack(id = "t1"): Track { return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("c1", 0)] }; }
function makeTimeline(): Timeline { return { ...defaultTimeline(), tracks: [makeTrack()] }; }

function makeDeps(store: EditorStore): AgentSessionDeps {
  const tools = buildCatalog();
  const ctx: ToolContext = { store, getManifest: () => ({ version: 2, entries: [], folders: [] }), newId: () => "gen-1" };
  const executor = new ToolExecutor(tools, ctx);
  class FakeGateway implements AiGateway {
    async *streamChat(_req: ChatRequest): AsyncIterable<StreamEvent> { /* no scripted turns needed */ }
    async generateImage() { return { images: [] }; }
  }
  return { gateway: new FakeGateway(), executor, tools, model: "test-model", newId: () => "msg-1" };
}

test("AgentPanel: no agent-skills-button when onOpenSkills is omitted", () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps(store));
  render(<AgentPanel session={session} model="test-model" />);
  expect(screen.queryByTestId("agent-skills-button")).not.toBeInTheDocument();
});

test("AgentPanel: agent-skills-button present with 'View Skills' tooltip, calls onOpenSkills on click", () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps(store));
  const onOpenSkills = vi.fn();
  render(<AgentPanel session={session} model="test-model" onOpenSkills={onOpenSkills} />);

  const btn = screen.getByTestId("agent-skills-button");
  expect(btn.getAttribute("title")).toBe("View Skills");

  fireEvent.click(btn);
  expect(onOpenSkills).toHaveBeenCalledTimes(1);
});

test("AgentPanel: header row renders for the skills button alone, even with no model configured", () => {
  const store = new EditorStore(makeTimeline());
  const session = new AgentSession(makeDeps(store));
  render(<AgentPanel session={session} onOpenSkills={vi.fn()} />);
  expect(screen.getByTestId("agent-panel-header")).toBeInTheDocument();
  expect(screen.getByTestId("agent-skills-button")).toBeInTheDocument();
});

// ── Editor wiring: the book button opens Settings with the Skills section ──

class FakeSkillStorage implements SkillStorage {
  files = new Map<string, string>();
  ledger: Record<string, string> = {};
  async list() { return Array.from(this.files.entries()).map(([id, text]) => ({ id, text })); }
  async read(id: string) { return this.files.get(id) ?? null; }
  async write(id: string, text: string) { this.files.set(id, text); }
  async remove(id: string) { this.files.delete(id); }
  async readLedger() { return { ...this.ledger }; }
  async writeLedger(l: Record<string, string>) { this.ledger = { ...l }; }
}

function makeSkillCatalogDeps(): SkillCatalogDeps {
  return {
    fetchText: async (url: string) => (url.endsWith("catalog.json") ? "[]" : ""),
    cacheRead: async () => null,
    cacheWrite: async () => {},
  };
}

function makeSettingsProps(skills: { store: SkillStore; catalog: SkillCatalog }) {
  const llmModels: ModelEntry[] = [{ id: "a/llm-1", label: "LLM One", kind: "llm" }];
  const imageModels: ModelEntry[] = [{ id: "b/img-1", label: "Img One", kind: "image" }];
  return {
    keyConfig: { kind: "keychain" as const, hasKey: false, onSetKey: vi.fn(), onClearKey: vi.fn() },
    llmModels,
    imageModels,
    agentModel: "a/llm-1",
    imageModel: "b/img-1",
    onAgentModelChange: vi.fn(),
    onImageModelChange: vi.fn(),
    confirmThreshold: 50,
    onConfirmThresholdChange: vi.fn(),
    skills,
  };
}

function makeMinimalEditorProps() {
  const store = new EditorStore(makeTimeline());
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

test("Editor: clicking the agent panel's book button opens Settings with the Skills section", async () => {
  const { store, media, library } = makeMinimalEditorProps();
  const agentSession = new AgentSession(makeDeps(store));
  const skillStore = new SkillStore(new FakeSkillStorage());
  const skillCatalog = new SkillCatalog(makeSkillCatalogDeps());

  render(
    <Editor
      store={store}
      media={media}
      library={library}
      agent={{
        session: agentSession,
        model: "test-model",
        settings: makeSettingsProps({ store: skillStore, catalog: skillCatalog }),
      }}
    />,
  );

  // Show the agent panel first (agent-toggle), then click its book button.
  fireEvent.click(screen.getByTestId("agent-toggle"));
  expect(screen.queryByTestId("settings-panel")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("agent-skills-button"));

  expect(await screen.findByTestId("settings-panel")).toBeInTheDocument();
  expect(screen.getByTestId("settings-skills")).toBeInTheDocument();
  expect(screen.getByTestId("skills-pane")).toBeInTheDocument();
});

test("Editor: no agent-skills-button when agent.settings.skills is not provided", () => {
  const { store, media, library } = makeMinimalEditorProps();
  const agentSession = new AgentSession(makeDeps(store));

  render(
    <Editor
      store={store}
      media={media}
      library={library}
      agent={{ session: agentSession, model: "test-model" }}
    />,
  );

  fireEvent.click(screen.getByTestId("agent-toggle"));
  expect(screen.queryByTestId("agent-skills-button")).not.toBeInTheDocument();
});
