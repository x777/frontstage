import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type Clip,
  type MediaFolder,
  type MediaManifestEntry,
  type Timeline,
  type Track,
  type TranscriptionResult,
} from "@palmier/core";
import type { ToolResult } from "@palmier/ai";
import { CaptionsTab } from "../src/media/CaptionsTab.js";
import { MediaPanel } from "../src/media/MediaPanel.js";

function baseClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c",
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 300, // 10s @ 30fps
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    ...over,
  };
}

function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function timelineOf(...tracks: Track[]): Timeline {
  return { ...defaultTimeline(), tracks };
}

function mediaEntry(id: string, over: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 10,
    hasAudio: true,
    ...over,
  };
}

function transcriptOf(words: TranscriptionResult["words"] = []): TranscriptionResult {
  return { text: "", words, segments: [] };
}

function makeLibrary(entries: MediaManifestEntry[]) {
  const map = new Map(entries.map((e) => [e.id, e]));
  const folders: MediaFolder[] = [];
  return {
    getSnapshot: () => ({ entries, folders }),
    subscribe: () => () => {},
    thumbnail: () => undefined,
    importFiles: async () => [],
    entry: (id: string) => map.get(id),
    createFolder: () => ({ id: "f", name: "New Folder" }),
    renameFolder: () => {},
    deleteFolders: () => ({ removedAssetIds: [] }),
    moveEntriesToFolder: () => {},
    moveFolderToFolder: () => {},
  };
}

interface TranscriptionOpts {
  hasKey?: boolean;
  cached?: Record<string, TranscriptionResult>;
  estimateCredits?: (d: number) => number;
}

function makeTranscription(opts: TranscriptionOpts = {}) {
  const cached = opts.cached ?? {};
  return {
    transcribe: vi.fn().mockResolvedValue(transcriptOf()),
    cachedTranscript: vi.fn(async (ref: string) => cached[ref] ?? null),
    hasKey: vi.fn().mockResolvedValue(opts.hasKey ?? true),
    estimateCredits: opts.estimateCredits ?? ((d: number) => Math.ceil(d)),
  };
}

function makeExecutor(result: ToolResult = { blocks: [{ kind: "text", text: JSON.stringify({ captionsAdded: 3 }) }], isError: false }) {
  return { execute: vi.fn().mockResolvedValue(result) };
}

// Standard fixture: one video track with two transcribable clips (v1/m1, v2/m2), both 10s.
function baseSetup() {
  const clip1 = baseClip({ id: "v1", mediaRef: "m1", startFrame: 0, durationFrames: 300 });
  const clip2 = baseClip({ id: "v2", mediaRef: "m2", startFrame: 300, durationFrames: 300 });
  const store = new EditorStore(timelineOf(track("t0", "video", [clip1, clip2])));
  const library = makeLibrary([mediaEntry("m1"), mediaEntry("m2")]);
  return { store, library };
}

test("renders the source/style/preset controls", async () => {
  const { store, library } = baseSetup();
  render(<CaptionsTab store={store} executor={makeExecutor()} transcription={makeTranscription()} library={library} />);
  await waitFor(() => expect(screen.getByTestId("captions-estimate")).not.toHaveTextContent(""));

  expect(screen.getByTestId("captions-source-select")).toBeInTheDocument();
  expect(screen.getByTestId("captions-language-input")).toBeInTheDocument();
  expect(screen.getByTestId("captions-textcase-select")).toBeInTheDocument();
  expect(screen.getByTestId("captions-maxwords-input")).toBeInTheDocument();
  expect(screen.getByTestId("captions-fontsize-input")).toBeInTheDocument();
  expect(screen.getByTestId("captions-fontname-input")).toBeInTheDocument();
  expect(screen.getByTestId("captions-color-input")).toBeInTheDocument();
  expect(screen.getByTestId("captions-centerx-input")).toBeInTheDocument();
  expect(screen.getByTestId("captions-centery-input")).toBeInTheDocument();
  expect(screen.getByTestId("captions-preset-gallery")).toBeInTheDocument();
  expect(screen.getByTestId("captions-generate")).toBeInTheDocument();

  const sourceSelect = screen.getByTestId("captions-source-select") as HTMLSelectElement;
  const optionLabels = Array.from(sourceSelect.options).map((o) => o.textContent);
  expect(optionLabels).toContain("Auto-detect");
  expect(optionLabels).toContain("Track V1");
  expect(optionLabels).not.toContain("Selected clips"); // no selection yet
});

test("estimate: Cached — no credits used when every target ref is already cached", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  render(<CaptionsTab store={store} executor={makeExecutor()} transcription={transcription} library={library} />);

  await waitFor(() => expect(screen.getByTestId("captions-estimate")).toHaveTextContent("Cached — no credits used"));
});

test("estimate: shows the formatted credits text when targets are uncached", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: {} });
  render(<CaptionsTab store={store} executor={makeExecutor()} transcription={transcription} library={library} />);

  // m1 + m2, 10s each, default estimateCredits = ceil(seconds) -> 20 credits total
  await waitFor(() => expect(screen.getByTestId("captions-estimate")).toHaveTextContent("20 credits"));
});

test("source=Selected clips resolves clipIds to the store selection", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  const executor = makeExecutor();
  render(<CaptionsTab store={store} executor={executor} transcription={transcription} library={library} />);

  act(() => store.select(["v1"]));
  await waitFor(() => expect(screen.getByTestId("captions-source-select")).toHaveTextContent("Selected clips"));

  fireEvent.change(screen.getByTestId("captions-source-select"), { target: { value: "selected" } });
  await waitFor(() => expect(screen.getByTestId("captions-generate")).not.toBeDisabled());

  await act(async () => { fireEvent.click(screen.getByTestId("captions-generate")); });

  expect(executor.execute).toHaveBeenCalledTimes(1);
  const [name, args] = executor.execute.mock.calls[0]!;
  expect(name).toBe("add_captions");
  expect((args as Record<string, unknown>).clipIds).toEqual(["v1"]);
  expect((args as Record<string, unknown>).confirm).toBe(true);
});

test("Generate assembles textCase/fontSize/preset (and omits clipIds for Auto-detect)", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  const executor = makeExecutor();
  render(<CaptionsTab store={store} executor={executor} transcription={transcription} library={library} />);

  fireEvent.change(screen.getByTestId("captions-textcase-select"), { target: { value: "upper" } });
  fireEvent.change(screen.getByTestId("captions-fontsize-input"), { target: { value: "60" } });
  fireEvent.click(screen.getByTestId("captions-preset-wordPop"));

  await waitFor(() => expect(screen.getByTestId("captions-generate")).not.toBeDisabled());
  await act(async () => { fireEvent.click(screen.getByTestId("captions-generate")); });

  const args = executor.execute.mock.calls[0]![1] as Record<string, unknown>;
  expect(args.textCase).toBe("upper");
  expect(args.fontSize).toBe(60);
  expect(args.animation).toEqual({ preset: "wordPop" });
  expect(args.confirm).toBe(true);
  expect(args.clipIds).toBeUndefined();
});

test("a highlight preset shows the highlightColor input and includes it in the args", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  const executor = makeExecutor();
  render(<CaptionsTab store={store} executor={executor} transcription={transcription} library={library} />);

  expect(screen.queryByTestId("captions-highlightcolor-input")).toBeNull();
  fireEvent.click(screen.getByTestId("captions-preset-highlightPop"));
  expect(screen.getByTestId("captions-highlightcolor-input")).toBeInTheDocument();

  await waitFor(() => expect(screen.getByTestId("captions-generate")).not.toBeDisabled());
  await act(async () => { fireEvent.click(screen.getByTestId("captions-generate")); });

  const args = executor.execute.mock.calls[0]![1] as Record<string, unknown>;
  expect(args.animation).toMatchObject({ preset: "highlightPop" });
  expect((args.animation as { highlightColor?: string }).highlightColor).toBeTruthy();
});

test("an error result from execute shows inline", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  const executor = makeExecutor({ blocks: [{ kind: "text", text: "no transcribable clips" }], isError: true });
  render(<CaptionsTab store={store} executor={executor} transcription={transcription} library={library} />);

  await waitFor(() => expect(screen.getByTestId("captions-generate")).not.toBeDisabled());
  await act(async () => { fireEvent.click(screen.getByTestId("captions-generate")); });

  expect(await screen.findByTestId("captions-error")).toHaveTextContent("no transcribable clips");
  expect(screen.queryByTestId("captions-success")).toBeNull();
});

test("a successful result summarizes captionsAdded and shows no error", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  const executor = makeExecutor({ blocks: [{ kind: "text", text: JSON.stringify({ captionsAdded: 7, trackIndex: 0, captionGroupId: "g" }) }], isError: false });
  render(<CaptionsTab store={store} executor={executor} transcription={transcription} library={library} />);

  await waitFor(() => expect(screen.getByTestId("captions-generate")).not.toBeDisabled());
  await act(async () => { fireEvent.click(screen.getByTestId("captions-generate")); });

  expect(await screen.findByTestId("captions-success")).toHaveTextContent("7 captions added");
  expect(screen.queryByTestId("captions-error")).toBeNull();
});

test("busy overlay covers the tab while add_captions is pending", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  let resolveExec!: (r: ToolResult) => void;
  const pending = new Promise<ToolResult>((resolve) => { resolveExec = resolve; });
  const executor = { execute: vi.fn().mockReturnValue(pending) };
  render(<CaptionsTab store={store} executor={executor} transcription={transcription} library={library} />);

  await waitFor(() => expect(screen.getByTestId("captions-generate")).not.toBeDisabled());
  await act(async () => { fireEvent.click(screen.getByTestId("captions-generate")); });

  expect(screen.getByTestId("generating-overlay")).toHaveTextContent("Transcribing");

  await act(async () => { resolveExec({ blocks: [{ kind: "text", text: JSON.stringify({ captionsAdded: 1 }) }], isError: false }); });
  await waitFor(() => expect(screen.queryByTestId("generating-overlay")).toBeNull());
});

test("keyless + uncached targets: Generate disabled with the settings hint", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ hasKey: false, cached: {} });
  render(<CaptionsTab store={store} executor={makeExecutor()} transcription={transcription} library={library} />);

  await waitFor(() => expect(screen.getByTestId("captions-key-hint")).toBeInTheDocument());
  expect(screen.getByTestId("captions-generate")).toBeDisabled();
});

test("keyless but all-cached: Generate stays enabled (no credits needed)", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ hasKey: false, cached: { m1: transcriptOf(), m2: transcriptOf() } });
  render(<CaptionsTab store={store} executor={makeExecutor()} transcription={transcription} library={library} />);

  await waitFor(() => expect(screen.getByTestId("captions-estimate")).toHaveTextContent("Cached — no credits used"));
  expect(screen.queryByTestId("captions-key-hint")).toBeNull();
  expect(screen.getByTestId("captions-generate")).not.toBeDisabled();
});

const ALL_PRESET_LABELS: Record<string, string> = {
  none: "None",
  fadeIn: "Fade In",
  popIn: "Pop In",
  slideUp: "Slide Up",
  typewriter: "Typewriter",
  wordReveal: "Word Reveal",
  wordSlide: "Word Slide",
  wordPop: "Word Pop",
  wordCycle: "Word Cycle",
  highlightPop: "Highlight Pop",
  highlightBlock: "Highlight Block",
};

test("the preset gallery renders all 11 presets with their labels", async () => {
  const { store, library } = baseSetup();
  render(<CaptionsTab store={store} executor={makeExecutor()} transcription={makeTranscription()} library={library} />);
  await waitFor(() => expect(screen.getByTestId("captions-estimate")).not.toHaveTextContent(""));

  for (const [id, label] of Object.entries(ALL_PRESET_LABELS)) {
    const card = screen.getByTestId(`captions-preset-${id}`);
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent(label);
  }
});

test("clicking a preset card updates aria-pressed and the selection", async () => {
  const { store, library } = baseSetup();
  render(<CaptionsTab store={store} executor={makeExecutor()} transcription={makeTranscription()} library={library} />);
  await waitFor(() => expect(screen.getByTestId("captions-estimate")).not.toHaveTextContent(""));

  expect(screen.getByTestId("captions-preset-none")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("captions-preset-wordSlide")).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(screen.getByTestId("captions-preset-wordSlide"));

  expect(screen.getByTestId("captions-preset-wordSlide")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("captions-preset-none")).toHaveAttribute("aria-pressed", "false");
});

test("the preset preview marks whether it respects prefers-reduced-motion", async () => {
  const { store, library } = baseSetup();
  const matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("matchMedia", matchMedia);

  try {
    render(<CaptionsTab store={store} executor={makeExecutor()} transcription={makeTranscription()} library={library} />);
    await waitFor(() => expect(screen.getByTestId("captions-estimate")).not.toHaveTextContent(""));
    fireEvent.click(screen.getByTestId("captions-preset-wordCycle"));
    expect(screen.getByTestId("captions-preset-preview")).toHaveAttribute("data-reduced-motion", "true");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("MediaPanel: the Media/Captions tab bar switches the panel body", async () => {
  const { store, library } = baseSetup();
  const transcription = makeTranscription({ cached: { m1: transcriptOf(), m2: transcriptOf() } });
  const executor = makeExecutor();
  render(<MediaPanel library={library} store={store} executor={executor} transcription={transcription} />);

  expect(screen.getByTestId("media-tab-media")).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByTestId("captions-tab")).toBeNull();

  fireEvent.click(screen.getByTestId("media-tab-captions"));
  expect(screen.getByTestId("media-tab-captions")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("captions-tab")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("media-tab-media"));
  expect(screen.getByTestId("media-tab-media")).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByTestId("captions-tab")).toBeNull();
});
