import { describe, expect, test, vi } from "vitest";
import {
  EditorStore,
  cuesFromCaptionClips,
  cuesFromTranscript,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  exportXmeml,
  exportFcpxml,
  formatSrt,
  formatVtt,
  type Clip,
  type MediaManifest,
  type SourceTimecode,
  type Timeline,
  type Track,
  type TranscriptionResult,
} from "@palmier/core";
import { exportProjectTool } from "../src/tools/export-tools.js";
import type { ToolContext } from "../src/index.js";

type InteropFacade = NonNullable<ToolContext["interopExport"]>;
type TranscriptionFacade = NonNullable<ToolContext["transcription"]>;

function makeClip(id: string, mediaRef: string, startFrame = 0) {
  return {
    id,
    mediaRef,
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

function makeCaptionClip(id: string, captionGroupId: string, textContent: string, startFrame = 0, durationFrames = 60) {
  return {
    ...makeClip(id, `caption-media-${id}`, startFrame),
    mediaType: "text" as const,
    sourceClipType: "text" as const,
    durationFrames,
    captionGroupId,
    textContent,
  };
}

function makeTrack(id: string, clips: Clip[]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function makeTranscriptionFacade(overrides: Partial<TranscriptionFacade> = {}): TranscriptionFacade {
  return {
    transcribe: vi.fn().mockRejectedValue(new Error("transcribe should never be called by export_project")),
    cachedTranscript: vi.fn().mockResolvedValue(null),
    hasKey: vi.fn().mockResolvedValue(false),
    estimateCredits: vi.fn().mockReturnValue(0),
    ...overrides,
  };
}

function makeTimeline(): Timeline {
  return {
    ...defaultTimeline(),
    tracks: [
      makeTrack("t1", [makeClip("c1", "media-1", 0), makeClip("c2", "media-2", 60)]),
      makeTrack("t2", [makeClip("c3", "media-1", 120)]), // media-1 reused — mediaRefs must dedupe
    ],
  };
}

function makeManifest(): MediaManifest {
  return {
    version: 2,
    entries: [
      { id: "media-1", name: "one.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/one.mp4" }, duration: 2 },
      { id: "media-2", name: "two.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/two.mp4" }, duration: 2 },
    ],
    folders: [],
  };
}

function makeInteropFacade(overrides: Partial<InteropFacade> = {}): InteropFacade {
  return {
    readTimecodes: vi.fn().mockResolvedValue(new Map<string, SourceTimecode>()),
    saveText: vi.fn().mockResolvedValue({ path: "/out/export.xml" }),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const store = new EditorStore(makeTimeline());
  return {
    store,
    getManifest: makeManifest,
    newId: () => "id",
    ...overrides,
  };
}

describe("export_project — mode validation", () => {
  // mode is z.string() + in-run validation, NOT z.enum: the enum-in-zod trap (M13A H2) — an enum in
  // the schema would reject unknown modes at the executor's safeParse gate, before run() ever runs,
  // making the custom "unknown mode" message below dead code.
  test("the schema accepts any string for mode — validation happens in run()", () => {
    const tool = exportProjectTool();
    for (const mode of ["video", "xml", "fcpxml", "palmier", "srt", "vtt", "not-a-mode"]) {
      expect(tool.inputSchema.safeParse({ mode }).success).toBe(true);
    }
  });

  test("run() rejects an unrecognized mode with a message listing the valid ones", async () => {
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "not-a-mode" }, makeCtx({ interopExport: makeInteropFacade() }));
    expect(result.isError).toBe(true);
    const text = (result.blocks[0] as { text: string }).text;
    expect(text).toMatch(/unknown mode/i);
    expect(text).toMatch(/srt/);
    expect(text).toMatch(/vtt/);
  });

  test("accepts resolve/fcp for fcpxmlTarget, rejects anything else", () => {
    const tool = exportProjectTool();
    for (const fcpxmlTarget of ["resolve", "fcp"]) {
      expect(tool.inputSchema.safeParse({ mode: "fcpxml", fcpxmlTarget }).success).toBe(true);
    }
    expect(tool.inputSchema.safeParse({ mode: "fcpxml", fcpxmlTarget: "premiere" }).success).toBe(false);
  });

  test("mode defaults to video when omitted", async () => {
    const tool = exportProjectTool();
    const result = await tool.run({}, makeCtx({ interopExport: makeInteropFacade() }));
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toMatchObject({ kind: "text" });
    const text = (result.blocks[0] as { text: string }).text;
    expect(text).toMatch(/video/i);
    expect(text).toMatch(/File menu/i);
  });
});

describe("export_project — deferrals", () => {
  test("video mode is deferred to the File menu, even without a facade", async () => {
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "video" }, makeCtx());
    expect(result.isError).toBe(true);
    expect((result.blocks[0] as { text: string }).text).toMatch(/File menu/i);
  });

  test("palmier mode is deferred, even without a facade", async () => {
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "palmier" }, makeCtx());
    expect(result.isError).toBe(true);
    expect((result.blocks[0] as { text: string }).text).toMatch(/palmier/i);
  });
});

describe("export_project — facade absent", () => {
  test("xml without ctx.interopExport errors", async () => {
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "xml" }, makeCtx());
    expect(result.isError).toBe(true);
    expect((result.blocks[0] as { text: string }).text).toMatch(/not available/i);
  });

  test("fcpxml without ctx.interopExport errors", async () => {
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "fcpxml" }, makeCtx());
    expect(result.isError).toBe(true);
  });
});

describe("export_project — xml happy path", () => {
  test("requests timecodes for exactly the timeline's mediaRefs, and the exporter output reaches saveText", async () => {
    const facade = makeInteropFacade();
    const ctx = makeCtx({ interopExport: facade, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    const result = await tool.run({ mode: "xml" }, ctx);

    expect(facade.readTimecodes).toHaveBeenCalledTimes(1);
    const requestedRefs = (facade.readTimecodes as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(requestedRefs).toEqual(["media-1", "media-2"]);

    const expectedXml = exportXmeml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectName: "MyProj",
      startTimecodes: new Map(),
    });

    expect(facade.saveText).toHaveBeenCalledTimes(1);
    const [defaultName, contents, kind, outputPath, overwrite] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(defaultName).toBe("MyProj.xml");
    expect(contents).toBe(expectedXml);
    expect(kind).toBe("xmeml");
    expect(outputPath).toBeUndefined();
    expect(overwrite).toBe(true);

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.blocks[0] as { text: string }).text);
    expect(payload).toMatchObject({ status: "exported", mode: "xml", path: "/out/export.xml" });
  });

  test("falls back to 'Project' when ctx.projectName is absent", async () => {
    const facade = makeInteropFacade();
    const ctx = makeCtx({ interopExport: facade });
    const tool = exportProjectTool();
    await tool.run({ mode: "xml" }, ctx);
    const [defaultName] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(defaultName).toBe("Project.xml");
  });

  test("passes outputPath and overwrite through to saveText", async () => {
    const facade = makeInteropFacade();
    const ctx = makeCtx({ interopExport: facade });
    const tool = exportProjectTool();
    await tool.run({ mode: "xml", outputPath: "/tmp/out.xml", overwrite: false }, ctx);
    const [, , , outputPath, overwrite] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(outputPath).toBe("/tmp/out.xml");
    expect(overwrite).toBe(false);
  });

  test("cancelled save surfaces as a non-error 'cancelled' status", async () => {
    const facade = makeInteropFacade({ saveText: vi.fn().mockResolvedValue({ cancelled: true }) });
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "xml" }, makeCtx({ interopExport: facade }));
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.blocks[0] as { text: string }).text);
    expect(payload).toEqual({ status: "cancelled", mode: "xml" });
  });

  test("overwrite=false against an existing file surfaces the facade's rejection as an error", async () => {
    const facade = makeInteropFacade({
      saveText: vi.fn().mockRejectedValue(new Error("output file already exists")),
    });
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "xml", outputPath: "/tmp/out.xml", overwrite: false }, makeCtx({ interopExport: facade }));
    expect(result.isError).toBe(true);
    expect((result.blocks[0] as { text: string }).text).toMatch(/already exists/);
  });
});

describe("export_project — fcpxml happy path", () => {
  test("routes to exportFcpxml and kind='fcpxml' with the .fcpxml extension", async () => {
    const facade = makeInteropFacade();
    const ctx = makeCtx({ interopExport: facade, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    await tool.run({ mode: "fcpxml" }, ctx);

    const expectedXml = exportFcpxml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectName: "MyProj",
      startTimecodes: new Map(),
    });

    const [defaultName, contents, kind] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(defaultName).toBe("MyProj.fcpxml");
    expect(contents).toBe(expectedXml);
    expect(kind).toBe("fcpxml");
  });

  test("fcpxmlTarget defaults to resolve when omitted (Swift's default)", async () => {
    const facade = makeInteropFacade();
    const ctx = makeCtx({ interopExport: facade, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    await tool.run({ mode: "fcpxml" }, ctx);

    const expectedDefault = exportFcpxml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectName: "MyProj",
      startTimecodes: new Map(),
    });
    const expectedResolve = exportFcpxml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectName: "MyProj",
      startTimecodes: new Map(),
      target: "resolve",
    });
    const [, contents] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(contents).toBe(expectedDefault);
    expect(contents).toBe(expectedResolve);
  });

  test("fcpxmlTarget='fcp' reaches the exporter and changes crop/position encoding", async () => {
    // A crop + non-fit transform on a clip whose source aspect differs from the sequence is the
    // only shape where resolve vs. fcp actually diverge — build a bespoke timeline/manifest for it
    // rather than the shared (identity-transform) fixtures above.
    const clip = {
      ...makeClip("c1", "media-v", 0),
      transform: { centerX: 0.75, centerY: 0.75, width: 1, height: 81.0 / 256.0, rotation: 0, flipHorizontal: false, flipVertical: false },
      crop: { left: 0.2, top: 0.05, right: 0.1, bottom: 0.05 },
    };
    const timeline: Timeline = { ...defaultTimeline(), width: 1080, height: 1920, tracks: [makeTrack("t1", [clip])] };
    const manifest: MediaManifest = {
      version: 2,
      entries: [
        {
          id: "media-v",
          name: "media-v.mp4",
          type: "video",
          source: { kind: "external", absolutePath: "/tmp/media-v.mp4" },
          duration: 2,
          sourceWidth: 1280,
          sourceHeight: 720,
        },
      ],
      folders: [],
    };
    const facade = makeInteropFacade();
    const ctx = makeCtx({ store: new EditorStore(timeline), getManifest: () => manifest, interopExport: facade, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    await tool.run({ mode: "fcpxml", fcpxmlTarget: "fcp" }, ctx);

    const expectedFcp = exportFcpxml(timeline, manifest.entries, { projectName: "MyProj", startTimecodes: new Map(), target: "fcp" });
    const expectedResolve = exportFcpxml(timeline, manifest.entries, { projectName: "MyProj", startTimecodes: new Map(), target: "resolve" });
    expect(expectedFcp).not.toBe(expectedResolve); // sanity: the two targets really do diverge here

    const [, contents] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(contents).toBe(expectedFcp);
  });

  test("propagates readTimecodes' map into the exporter", async () => {
    const tc: SourceTimecode = { frame: 108000, quanta: 30, dropFrame: false };
    const facade = makeInteropFacade({
      readTimecodes: vi.fn().mockResolvedValue(new Map([["media-1", tc]])),
    });
    const ctx = makeCtx({ interopExport: facade, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    await tool.run({ mode: "fcpxml" }, ctx);

    const expectedXml = exportFcpxml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectName: "MyProj",
      startTimecodes: new Map([["media-1", tc]]),
    });
    const [, contents] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(contents).toBe(expectedXml);
    // sanity: differs from the zero-tc export (the #247 regression this whole plan protects)
    const zeroTcXml = exportFcpxml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectName: "MyProj",
      startTimecodes: new Map(),
    });
    expect(contents).not.toBe(zeroTcXml);
  });
});

describe("export_project — projectRoot (M12B fast-follow)", () => {
  function makeProjectManifest(): MediaManifest {
    return {
      version: 2,
      entries: [
        { id: "media-1", name: "one.mp4", type: "video", source: { kind: "project", relativePath: "media/one.mp4" }, duration: 2 },
        { id: "media-2", name: "two.mp4", type: "video", source: { kind: "project", relativePath: "media/two.mp4" }, duration: 2 },
      ],
      folders: [],
    };
  }

  test("desktop-like facade: getProjectRoot() feeds the exporter, producing an absolute file:// URL", async () => {
    const facade = makeInteropFacade({ getProjectRoot: () => "/Users/alice/Movies/Beach Edit" });
    const ctx = makeCtx({ interopExport: facade, getManifest: makeProjectManifest, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    await tool.run({ mode: "fcpxml" }, ctx);

    const expectedXml = exportFcpxml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectRoot: "/Users/alice/Movies/Beach Edit",
      projectName: "MyProj",
      startTimecodes: new Map(),
    });
    const [, contents] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(contents).toBe(expectedXml);
    expect(contents).toContain('src="file:///Users/alice/Movies/Beach%20Edit/media/one.mp4"');
  });

  test("web-like facade (no getProjectRoot): keeps the best-effort <projectName> fallback path", async () => {
    const facade = makeInteropFacade(); // no getProjectRoot member, mirrors createWebInteropExport
    const ctx = makeCtx({ interopExport: facade, getManifest: makeProjectManifest, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    await tool.run({ mode: "fcpxml" }, ctx);

    const expectedXml = exportFcpxml(ctx.store.getSnapshot().timeline, ctx.getManifest().entries, {
      projectName: "MyProj",
      startTimecodes: new Map(),
    });
    const [, contents] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(contents).toBe(expectedXml);
    expect(contents).toContain('src="file:///MyProj/media/one.mp4"');
  });
});

describe("export_project — srt/vtt from timeline caption clips", () => {
  function makeCaptionTimeline(): Timeline {
    return {
      ...defaultTimeline(),
      fps: 30,
      tracks: [
        makeTrack("t1", [
          makeCaptionClip("cap2", "g1", "Second", 60, 30),
          makeCaptionClip("cap1", "g1", "First", 0, 30),
        ]),
      ],
    };
  }

  test("srt: formats cuesFromCaptionClips (chronological) and saves with kind='srt'", async () => {
    const facade = makeInteropFacade();
    const timeline = makeCaptionTimeline();
    const ctx = makeCtx({ store: new EditorStore(timeline), interopExport: facade, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    const result = await tool.run({ mode: "srt" }, ctx);

    const expectedCues = cuesFromCaptionClips(timeline, timeline.fps);
    expect(expectedCues.map((c) => c.text)).toEqual(["First", "Second"]);
    const expectedSrt = formatSrt(expectedCues);

    const [defaultName, contents, kind, outputPath, overwrite] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(defaultName).toBe("MyProj.srt");
    expect(contents).toBe(expectedSrt);
    expect(kind).toBe("srt");
    expect(outputPath).toBeUndefined();
    expect(overwrite).toBe(true);

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.blocks[0] as { text: string }).text);
    expect(payload).toMatchObject({ status: "exported", mode: "srt", path: "/out/export.xml", cueCount: 2 });
  });

  test("vtt: formats cuesFromCaptionClips and saves with kind='vtt'", async () => {
    const facade = makeInteropFacade();
    const timeline = makeCaptionTimeline();
    const ctx = makeCtx({ store: new EditorStore(timeline), interopExport: facade, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    await tool.run({ mode: "vtt" }, ctx);

    const expectedVtt = formatVtt(cuesFromCaptionClips(timeline, timeline.fps));
    const [defaultName, contents, kind] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(defaultName).toBe("MyProj.vtt");
    expect(contents).toBe(expectedVtt);
    expect(kind).toBe("vtt");
  });

  test("no caption clips on the timeline errors clearly, without touching saveText", async () => {
    const facade = makeInteropFacade();
    const tool = exportProjectTool(); // makeCtx()'s default timeline has plain video clips, no captions
    const result = await tool.run({ mode: "srt" }, makeCtx({ interopExport: facade }));
    expect(result.isError).toBe(true);
    expect((result.blocks[0] as { text: string }).text).toMatch(/no caption clips/i);
    expect(facade.saveText).not.toHaveBeenCalled();
  });

  test("without ctx.interopExport, srt/vtt error the same way xml/fcpxml do", async () => {
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "srt" }, makeCtx());
    expect(result.isError).toBe(true);
    expect((result.blocks[0] as { text: string }).text).toMatch(/not available/i);
  });

  test("cancelled save surfaces as a non-error 'cancelled' status", async () => {
    const facade = makeInteropFacade({ saveText: vi.fn().mockResolvedValue({ cancelled: true }) });
    const timeline = makeCaptionTimeline();
    const ctx = makeCtx({ store: new EditorStore(timeline), interopExport: facade });
    const tool = exportProjectTool();
    const result = await tool.run({ mode: "vtt" }, ctx);
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.blocks[0] as { text: string }).text);
    expect(payload).toEqual({ status: "cancelled", mode: "vtt" });
  });
});

describe("export_project — srt/vtt from a cached transcript (captionsSource.mediaRef)", () => {
  function makeTranscript(): TranscriptionResult {
    return {
      text: "Hello world",
      words: [],
      segments: [
        { text: "Hello", start: 0, end: 1 },
        { text: "world", start: 1, end: 2 },
      ],
    };
  }

  test("happy path: cachedTranscript's segments -> cuesFromTranscript -> formatted payload reaches saveText", async () => {
    const facade = makeInteropFacade();
    const transcript = makeTranscript();
    const transcription = makeTranscriptionFacade({ cachedTranscript: vi.fn().mockResolvedValue(transcript) });
    const ctx = makeCtx({ interopExport: facade, transcription, projectName: () => "MyProj" });
    const tool = exportProjectTool();

    const result = await tool.run({ mode: "srt", captionsSource: { mediaRef: "media-1" } }, ctx);

    expect(transcription.cachedTranscript).toHaveBeenCalledWith("media-1");
    expect(transcription.transcribe).not.toHaveBeenCalled();

    const expectedSrt = formatSrt(cuesFromTranscript(transcript));
    const [defaultName, contents, kind] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(defaultName).toBe("MyProj.srt");
    expect(contents).toBe(expectedSrt);
    expect(kind).toBe("srt");

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.blocks[0] as { text: string }).text);
    expect(payload).toMatchObject({ status: "exported", mode: "srt", cueCount: 2 });
  });

  test("vtt happy path via captionsSource.mediaRef", async () => {
    const facade = makeInteropFacade();
    const transcript = makeTranscript();
    const transcription = makeTranscriptionFacade({ cachedTranscript: vi.fn().mockResolvedValue(transcript) });
    const ctx = makeCtx({ interopExport: facade, transcription });
    const tool = exportProjectTool();

    await tool.run({ mode: "vtt", captionsSource: { mediaRef: "media-1" } }, ctx);

    const expectedVtt = formatVtt(cuesFromTranscript(transcript));
    const [, contents, kind] = (facade.saveText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(contents).toBe(expectedVtt);
    expect(kind).toBe("vtt");
  });

  test("uncached mediaRef errors naming get_transcript/add_captions, and never calls transcribe", async () => {
    const facade = makeInteropFacade();
    const transcription = makeTranscriptionFacade({ cachedTranscript: vi.fn().mockResolvedValue(null) });
    const ctx = makeCtx({ interopExport: facade, transcription });
    const tool = exportProjectTool();

    const result = await tool.run({ mode: "srt", captionsSource: { mediaRef: "media-missing" } }, ctx);

    expect(result.isError).toBe(true);
    const text = (result.blocks[0] as { text: string }).text;
    expect(text).toMatch(/get_transcript/);
    expect(text).toMatch(/add_captions/);
    expect(transcription.transcribe).not.toHaveBeenCalled();
    expect(facade.saveText).not.toHaveBeenCalled();
  });

  test("without ctx.transcription, a mediaRef request errors cleanly instead of falling back to caption clips", async () => {
    const facade = makeInteropFacade();
    const ctx = makeCtx({ interopExport: facade }); // no ctx.transcription
    const tool = exportProjectTool();

    const result = await tool.run({ mode: "srt", captionsSource: { mediaRef: "media-1" } }, ctx);

    expect(result.isError).toBe(true);
    expect(facade.saveText).not.toHaveBeenCalled();
  });
});
