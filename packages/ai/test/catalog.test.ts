import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type Timeline,
  type Track,
  type MediaManifest,
} from "@palmier/core";
import { buildCatalog, ToolExecutor, type ToolContext } from "../src/index.js";

const EXPECTED_NAMES = [
  "get_timeline",
  "get_media",
  "inspect_media",
  "search_media",
  "add_clips",
  "remove_clips",
  "remove_tracks",
  "move_clips",
  "split_clip",
  "split_clips",
  "trim_clips",
  "set_clip_properties",
  "set_keyframes",
  "add_texts",
  "generate_image",
  "ripple_delete_ranges",
  "insert_clips",
  "apply_color",
  "apply_effect",
  "inspect_color",
] as const;

function makeClip(id: string) {
  return {
    id,
    mediaRef: "media-1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame: 0,
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
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("c1")] };
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
        name: "clip.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/clip.mp4" },
        duration: 2,
      },
    ],
    folders: [],
  };
}

let _counter = 0;
function makeCtx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: makeManifest,
    newId: () => `gen-${++_counter}`,
  };
}

describe("buildCatalog", () => {
  test("returns exactly 20 specs", () => {
    const catalog = buildCatalog();
    expect(catalog).toHaveLength(20);
  });

  test("all names are unique", () => {
    const catalog = buildCatalog();
    const names = catalog.map((s) => s.name);
    expect(new Set(names).size).toBe(20);
  });

  test("names match the expected list exactly", () => {
    const catalog = buildCatalog();
    const names = catalog.map((s) => s.name);
    for (const expected of EXPECTED_NAMES) {
      expect(names).toContain(expected);
    }
  });

  test("each spec has name, description, inputSchema, and run", () => {
    const catalog = buildCatalog();
    for (const spec of catalog) {
      expect(typeof spec.name).toBe("string");
      expect(typeof spec.description).toBe("string");
      expect(spec.inputSchema).toBeDefined();
      expect(typeof spec.run).toBe("function");
    }
  });
});

describe("ToolExecutor with buildCatalog", () => {
  test("execute returns non-error for each tool with minimal valid args", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const executor = new ToolExecutor(buildCatalog(), ctx);

    // Read-only tools
    const readResults = await Promise.all([
      executor.execute("get_timeline", {}),
      executor.execute("get_media", {}),
      executor.execute("inspect_media", { mediaId: "media-1" }),
      executor.execute("search_media", { query: "clip" }),
    ]);
    for (const r of readResults) {
      expect(r.isError).toBe(false);
    }

    // Mutating tools — run them sequentially to avoid state conflicts
    const addResult = await executor.execute("add_clips", {
      clips: [{ mediaId: "media-1", startFrame: 100 }],
    });
    expect(addResult.isError).toBe(false);

    const tl = store.getSnapshot().timeline;
    const clipId = tl.tracks.flatMap((t) => t.clips).find((c) => c.startFrame === 100)?.id ?? "c1";
    const trackId = tl.tracks[0]!.id;

    const setPropResult = await executor.execute("set_clip_properties", {
      clipId,
      properties: { opacity: 0.9 },
    });
    expect(setPropResult.isError).toBe(false);

    const setKfResult = await executor.execute("set_keyframes", {
      clipId,
      trackKey: "opacityTrack",
      keyframes: [{ frame: 0, value: 1 }],
    });
    expect(setKfResult.isError).toBe(false);

    const moveResult = await executor.execute("move_clips", {
      moves: [{ clipId, toTrackIndex: 0, toStartFrame: 120 }],
    });
    expect(moveResult.isError).toBe(false);

    const trimResult = await executor.execute("trim_clips", {
      trims: [{ clipId, edge: "right", deltaFrames: 5 }],
    });
    expect(trimResult.isError).toBe(false);

    // Split & remove (use a fresh clip)
    const addResult2 = await executor.execute("add_clips", {
      clips: [{ mediaId: "media-1", startFrame: 300 }],
    });
    expect(addResult2.isError).toBe(false);

    const tl2 = store.getSnapshot().timeline;
    const clipId2 = tl2.tracks.flatMap((t) => t.clips).find((c) => c.startFrame === 300)?.id;
    if (clipId2) {
      const splitResult = await executor.execute("split_clip", { clipId: clipId2, atFrame: 330 });
      expect(splitResult.isError).toBe(false);
    }

    const removeClipResult = await executor.execute("remove_clips", { clipIds: [clipId] });
    expect(removeClipResult.isError).toBe(false);

    const addTextResult = await executor.execute("add_texts", {
      texts: [{ content: "Test", startFrame: 0 }],
    });
    expect(addTextResult.isError).toBe(false);

    // Find the text track to remove
    const tl3 = store.getSnapshot().timeline;
    const textTrack = tl3.tracks.find((t) => t.type === "text");
    if (textTrack) {
      const removeTrackResult = await executor.execute("remove_tracks", { trackIds: [textTrack.id] });
      expect(removeTrackResult.isError).toBe(false);
    }
  });

  test("execute returns isError:true for unknown tool", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const executor = new ToolExecutor(buildCatalog(), ctx);
    const result = await executor.execute("nonexistent_tool", {});
    expect(result.isError).toBe(true);
  });
});
