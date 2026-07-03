import { renderHook, act } from "@testing-library/react";
import { useExportCommand } from "../src/editor/use-export-command.js";
import type { ExportGateway, ExportTarget } from "../src/editor/export-gateway.js";
import {
  cuesFromCaptionClips,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  exportFcpxml,
  exportXmeml,
  formatSrt,
  formatVtt,
  type MediaManifestEntry,
  type SourceTimecode,
  type Timeline,
  type Track,
} from "@palmier/core";
import type { ToolContext } from "@palmier/ai";
import type { MediaByteSource } from "@palmier/engine";

// A well-formed (empty) timeline — canExportCaptions inspects .tracks on every render, so this must
// satisfy Timeline's shape even in tests that don't otherwise care about timeline content.
const fakeTimeline: Timeline = defaultTimeline();
const fakeMedia = {} as MediaByteSource;

function realTimeline(): Timeline {
  return { ...defaultTimeline(), tracks: [] };
}

// mediaRef-referencing clip, for tests that need the exporter to actually resolve a media resource
// (realTimeline()'s empty tracks never surface any <asset>/media-rep — see projectRoot tests below).
function timelineWithClip(mediaRef: string): Timeline {
  const track: Track = {
    id: "t1",
    type: "video",
    muted: false,
    hidden: false,
    syncLocked: false,
    clips: [
      {
        id: "c1",
        mediaRef,
        mediaType: "video",
        sourceClipType: "video",
        startFrame: 0,
        durationFrames: 60,
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
      },
    ],
  };
  return { ...defaultTimeline(), tracks: [track] };
}

// Two caption clips (a text-typed clip with captionGroupId) out of chronological order, at 30fps.
function timelineWithCaptionClips(): Timeline {
  function captionClip(id: string, content: string, startFrame: number): Track["clips"][number] {
    return {
      id,
      mediaRef: `caption-media-${id}`,
      mediaType: "text",
      sourceClipType: "text",
      startFrame,
      durationFrames: 30,
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
      captionGroupId: "g1",
      textContent: content,
    };
  }
  const track: Track = {
    id: "t1",
    type: "video",
    muted: false,
    hidden: false,
    syncLocked: false,
    clips: [captionClip("cap2", "Second", 30), captionClip("cap1", "First", 0)],
  };
  return { ...defaultTimeline(), fps: 30, tracks: [track] };
}

type InteropFacade = NonNullable<ToolContext["interopExport"]>;

function makeInteropFacade(overrides: Partial<InteropFacade> = {}): InteropFacade {
  return {
    readTimecodes: vi.fn().mockResolvedValue(new Map<string, SourceTimecode>()),
    saveText: vi.fn().mockResolvedValue({ path: "/out/export.xml" }),
    ...overrides,
  };
}

function makeGateway(overrides: Partial<ExportGateway> = {}): ExportGateway {
  return {
    pickTarget: vi.fn().mockResolvedValue({ label: "out.mp4" } satisfies ExportTarget),
    run: vi.fn().mockImplementation(async (_tl, _media, _target, onProgress) => {
      onProgress(1, 3);
      onProgress(2, 3);
      onProgress(3, 3);
    }),
    ...overrides,
  };
}

function makeRunProjectCommand() {
  return vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => {
    await fn();
  });
}

test("canExport is false when no gateway", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExport).toBe(false);
});

test("canExport is true when gateway provided", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: makeGateway(),
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExport).toBe(true);
});

test("exportProject calls pickTarget with suggested name and progresses state", async () => {
  const gateway = makeGateway();
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: gateway,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "My Project",
      runProjectCommand,
    })
  );

  expect(result.current.exportState).toBeNull();

  await act(async () => {
    result.current.exportProject();
  });

  expect(gateway.pickTarget).toHaveBeenCalledWith("My Project");
  expect(gateway.run).toHaveBeenCalledTimes(1);
  // After completion, state should be null
  expect(result.current.exportState).toBeNull();
});

test("exportProject is a no-op when no gateway", async () => {
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject();
  });

  expect(runProjectCommand).not.toHaveBeenCalled();
});

test("cancel (pickTarget returns null) keeps exportState null, run never called", async () => {
  const gateway = makeGateway({
    pickTarget: vi.fn().mockResolvedValue(null),
  });
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: gateway,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject();
  });

  expect(gateway.run).not.toHaveBeenCalled();
  expect(result.current.exportState).toBeNull();
});

test("re-entrancy: calling exportProject while running is a no-op", async () => {
  let resolveRun!: () => void;
  const runPromise = new Promise<void>((res) => { resolveRun = res; });
  const gateway = makeGateway({
    run: vi.fn().mockImplementation(() => runPromise),
  });
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: gateway,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  // Start first run (don't await — let it hang)
  act(() => { result.current.exportProject(); });

  // Try to call again while first is running
  await act(async () => {
    result.current.exportProject();
  });

  // run should only have been called once
  expect(gateway.run).toHaveBeenCalledTimes(1);

  // Clean up — resolve the hanging run
  await act(async () => { resolveRun(); });
});

// ── xml / fcpxml format choice (M12B T3) ──────────────────────────────────────

test("canExportXml is false when no interopExport facade", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExportXml).toBe(false);
});

test("canExportXml is true when an interopExport facade is provided", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: makeInteropFacade(),
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExportXml).toBe(true);
});

test("exportProject('xmeml') requests timecodes for the timeline's mediaRefs and saves exportXmeml's output", async () => {
  const facade = makeInteropFacade();
  const runProjectCommand = makeRunProjectCommand();
  const entries: MediaManifestEntry[] = [
    { id: "m1", name: "a.mp4", type: "video", source: { kind: "external", absolutePath: "/a.mp4" }, duration: 2 },
  ];
  const timeline = realTimeline();

  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: facade,
      getTimeline: () => timeline,
      getMediaEntries: () => entries,
      media: fakeMedia,
      suggestedName: () => "MyProj",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("xmeml");
  });

  expect(facade.readTimecodes).toHaveBeenCalledWith([]);
  const expectedXml = exportXmeml(timeline, entries, { projectName: "MyProj", startTimecodes: new Map() });
  expect(facade.saveText).toHaveBeenCalledWith("MyProj.xml", expectedXml, "xmeml", undefined, true);
});

test("exportProject('fcpxml') saves exportFcpxml's output with kind='fcpxml'", async () => {
  const facade = makeInteropFacade();
  const runProjectCommand = makeRunProjectCommand();
  const timeline = realTimeline();

  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: facade,
      getTimeline: () => timeline,
      getMediaEntries: () => [],
      media: fakeMedia,
      suggestedName: () => "MyProj",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("fcpxml");
  });

  const expectedXml = exportFcpxml(timeline, [], { projectName: "MyProj", startTimecodes: new Map() });
  expect(facade.saveText).toHaveBeenCalledWith("MyProj.fcpxml", expectedXml, "fcpxml", undefined, true);
});

test("exportProject('fcpxml') passes the facade's getProjectRoot into the exporter, producing an absolute file:// URL", async () => {
  const facade = makeInteropFacade({ getProjectRoot: () => "/Users/alice/Movies/Beach Edit" });
  const runProjectCommand = makeRunProjectCommand();
  const entries: MediaManifestEntry[] = [
    { id: "m1", name: "a.mp4", type: "video", source: { kind: "project", relativePath: "media/a.mp4" }, duration: 2 },
  ];
  const timeline = timelineWithClip("m1");

  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: facade,
      getTimeline: () => timeline,
      getMediaEntries: () => entries,
      media: fakeMedia,
      suggestedName: () => "MyProj",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("fcpxml");
  });

  const expectedXml = exportFcpxml(timeline, entries, {
    projectRoot: "/Users/alice/Movies/Beach Edit",
    projectName: "MyProj",
    startTimecodes: new Map(),
  });
  expect(facade.saveText).toHaveBeenCalledWith("MyProj.fcpxml", expectedXml, "fcpxml", undefined, true);
  expect(expectedXml).toContain('src="file:///Users/alice/Movies/Beach%20Edit/media/a.mp4"');
});

test("exportProject('fcpxml') with no getProjectRoot on the facade (web-like) keeps the best-effort fallback path", async () => {
  const facade = makeInteropFacade(); // no getProjectRoot member, mirrors createWebInteropExport
  const runProjectCommand = makeRunProjectCommand();
  const entries: MediaManifestEntry[] = [
    { id: "m1", name: "a.mp4", type: "video", source: { kind: "project", relativePath: "media/a.mp4" }, duration: 2 },
  ];
  const timeline = timelineWithClip("m1");

  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: facade,
      getTimeline: () => timeline,
      getMediaEntries: () => entries,
      media: fakeMedia,
      suggestedName: () => "MyProj",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("fcpxml");
  });

  const expectedXml = exportFcpxml(timeline, entries, { projectName: "MyProj", startTimecodes: new Map() });
  expect(facade.saveText).toHaveBeenCalledWith("MyProj.fcpxml", expectedXml, "fcpxml", undefined, true);
  expect(expectedXml).toContain('src="file:///MyProj/media/a.mp4"');
});

test("exportProject('xmeml') is a no-op when no interopExport facade", async () => {
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: () => realTimeline(),
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("xmeml");
  });

  expect(runProjectCommand).not.toHaveBeenCalled();
});

test("exportProject() defaults to 'video'", async () => {
  const gateway = makeGateway();
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: gateway,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject();
  });

  expect(gateway.pickTarget).toHaveBeenCalledTimes(1);
});

// ── srt / vtt caption export (M14A T1) ─────────────────────────────────────────

test("canExportCaptions is false when no interopExport facade, even with caption clips on the timeline", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: timelineWithCaptionClips,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExportCaptions).toBe(false);
});

test("canExportCaptions is false when the timeline has no caption clips, even with a facade", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: makeInteropFacade(),
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExportCaptions).toBe(false);
});

test("canExportCaptions is true when a facade is present and the timeline has caption clips", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: makeInteropFacade(),
      getTimeline: timelineWithCaptionClips,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExportCaptions).toBe(true);
});

test("exportProject('srt') formats cuesFromCaptionClips (chronological) and saves with kind='srt'", async () => {
  const facade = makeInteropFacade();
  const runProjectCommand = makeRunProjectCommand();
  const timeline = timelineWithCaptionClips();

  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: facade,
      getTimeline: () => timeline,
      media: fakeMedia,
      suggestedName: () => "MyProj",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("srt");
  });

  const cues = cuesFromCaptionClips(timeline, timeline.fps);
  expect(cues.map((c) => c.text)).toEqual(["First", "Second"]);
  const expectedSrt = formatSrt(cues);
  expect(facade.saveText).toHaveBeenCalledWith("MyProj.srt", expectedSrt, "srt", undefined, true);
});

test("exportProject('vtt') formats cuesFromCaptionClips and saves with kind='vtt'", async () => {
  const facade = makeInteropFacade();
  const runProjectCommand = makeRunProjectCommand();
  const timeline = timelineWithCaptionClips();

  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: facade,
      getTimeline: () => timeline,
      media: fakeMedia,
      suggestedName: () => "MyProj",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("vtt");
  });

  const expectedVtt = formatVtt(cuesFromCaptionClips(timeline, timeline.fps));
  expect(facade.saveText).toHaveBeenCalledWith("MyProj.vtt", expectedVtt, "vtt", undefined, true);
});

test("exportProject('srt') is a no-op when the timeline has no caption clips", async () => {
  const facade = makeInteropFacade();
  const runProjectCommand = makeRunProjectCommand();

  const { result } = renderHook(() =>
    useExportCommand({
      interopExport: facade,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "MyProj",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("srt");
  });

  expect(facade.saveText).not.toHaveBeenCalled();
});

test("exportProject('srt') is a no-op when no interopExport facade", async () => {
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: timelineWithCaptionClips,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject("srt");
  });

  expect(runProjectCommand).not.toHaveBeenCalled();
});
