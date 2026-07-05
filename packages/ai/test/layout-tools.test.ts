import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTransform,
  defaultCrop,
  transformAt,
  type Clip,
  type MediaManifest,
  type MediaManifestEntry,
  type Timeline,
  type Track,
} from "@frontstage/core";
import { applyLayoutTool } from "../src/tools/layout-tools.js";
import type { ToolContext } from "../src/index.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
function makeCtx(store: EditorStore, manifest: MediaManifest): ToolContext {
  return { store, getManifest: () => manifest, newId: () => `gen-${++_idCounter}` };
}

function assetEntry(id: string, over: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "external", absolutePath: `/tmp/${id}.mp4` },
    duration: 5,
    sourceWidth: 1920,
    sourceHeight: 1080,
    hasAudio: false,
    ...over,
  };
}

function manifestOf(...entries: MediaManifestEntry[]): MediaManifest {
  return { version: 2, entries, folders: [] };
}

function baseClip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: "a",
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
    ...over,
  };
}

function track(id: string, clips: Clip[] = [], type: Track["type"] = "video"): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function timeline(tracks: Track[] = []): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

function clipOf(tl: Timeline, id: string): Clip {
  return tl.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
}

function clipsWithMediaRef(tl: Timeline, mediaRef: string): Clip[] {
  return tl.tracks.flatMap((t) => t.clips).filter((c) => c.mediaRef === mediaRef);
}

const spec = applyLayoutTool();

// ── validation matrix (Swift ApplyLayoutTests.rejectsInvalidInput, ported) ──────────────────────

describe("apply_layout — validation matrix", () => {
  function harness() {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const tl = timeline([track("t1", [baseClip("cx", { mediaRef: "a" })])]);
    const store = new EditorStore(tl);
    return makeCtx(store, manifest);
  }

  const cases: [string, Record<string, unknown>][] = [
    ["unknown layout", { layout: "hexagon", durationFrames: 30, slots: [{ slot: "left", mediaRef: "a" }] }],
    ["unknown slot", { layout: "side_by_side", durationFrames: 30, slots: [{ slot: "left", mediaRef: "a" }, { slot: "mid", mediaRef: "b" }] }],
    ["missing slot", { layout: "side_by_side", durationFrames: 30, slots: [{ slot: "left", mediaRef: "a" }] }],
    ["mixed sources across slots", { layout: "side_by_side", durationFrames: 30, slots: [{ slot: "left", clipIds: ["cx"] }, { slot: "right", mediaRef: "b" }] }],
    ["no duration", { layout: "side_by_side", slots: [{ slot: "left", mediaRef: "a" }, { slot: "right", mediaRef: "b" }] }],
    ["both source + clip", { layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "a", clipIds: ["cx"] }] }],
    ["invalid anchor", { layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "a", anchor: "diagonal" }] }],
    ["anchor out of range", { layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "a", anchorY: 1.5 }] }],
    ["duplicate clipIds", { layout: "side_by_side", slots: [{ slot: "left", clipIds: ["cx"] }, { slot: "right", clipIds: ["cx"] }] }],
    ["empty clipIds", { layout: "side_by_side", slots: [{ slot: "left", clipIds: [] }, { slot: "right", clipIds: ["cx"] }] }],
    ["invalid fit", { layout: "full", durationFrames: 30, fit: "stretch", slots: [{ slot: "main", mediaRef: "a" }] }],
    ["empty slots array", { layout: "full", durationFrames: 30, slots: [] }],
    ["duplicate slot", { layout: "side_by_side", durationFrames: 30, slots: [{ slot: "left", mediaRef: "a" }, { slot: "left", mediaRef: "b" }] }],
  ];

  for (const [label, args] of cases) {
    test(`rejects: ${label}`, async () => {
      const ctx = harness();
      const r = await spec.run(args, ctx);
      expect(r.isError, `expected error for: ${label}`).toBe(true);
    });
  }

  test("unknown layout — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "hexagon", slots: [{ slot: "left", mediaRef: "a" }] }, ctx);
    expect(r.blocks[0]!.kind === "text" && r.blocks[0]!.text).toContain("unknown layout 'hexagon'. Valid: full, side_by_side, top_bottom");
  });

  test("unknown slot — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "side_by_side", durationFrames: 30, slots: [{ slot: "left", mediaRef: "a" }, { slot: "mid", mediaRef: "b" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("slots[1]: 'mid' is not a slot of layout 'side_by_side'. Slots: left, right");
  });

  test("missing slot — exact message, sorted", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "grid_2x2", durationFrames: 30, slots: [{ slot: "top_left", mediaRef: "a" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("layout 'grid_2x2' needs every slot filled. Missing: bottom_left, bottom_right, top_right");
  });

  test("mixed mediaRef/clipIds across slots — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "side_by_side", durationFrames: 30, slots: [{ slot: "left", clipIds: ["cx"] }, { slot: "right", mediaRef: "b" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("apply_layout: don't mix 'mediaRef' and 'clipIds' — either place new clips (all mediaRef) or re-layout existing clips (all clipIds).");
  });

  test("provide exactly one of mediaRef/clipIds — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "a", clipIds: ["cx"] }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("slots[0]: provide exactly one of 'mediaRef' or 'clipIds'");
  });

  test("duplicate clip across slots — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "side_by_side", slots: [{ slot: "left", clipIds: ["cx"] }, { slot: "right", clipIds: ["cx"] }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("slots[1]: clip 'cx' is assigned to more than one slot; each clip can fill only one.");
  });

  test("startFrame < 0 — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "full", startFrame: -5, durationFrames: 30, slots: [{ slot: "main", mediaRef: "a" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("startFrame must be >= 0 (got -5)");
  });

  test("no durationFrames when placing — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "full", slots: [{ slot: "main", mediaRef: "a" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("apply_layout placing new clips requires durationFrames >= 1.");
  });

  test("unknown media asset — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "zzz" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("Media asset not found: zzz");
  });

  test("asset wrong type — exact message", async () => {
    const manifest = manifestOf(assetEntry("aud", { type: "audio" }));
    const store = new EditorStore(timeline([]));
    const ctx = makeCtx(store, manifest);
    const r = await spec.run({ layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "aud" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("slot 'main': asset aud is audio; layout slots take video or image.");
  });

  test("invalid anchor — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "a", anchor: "diagonal" }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe(
      "slots[0]: invalid anchor 'diagonal'. Valid: bottom, bottom_left, bottom_right, center, left, right, top, top_left, top_right, or anchorX/anchorY for in-between values.",
    );
  });

  test("anchorY out of range — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "full", durationFrames: 30, slots: [{ slot: "main", mediaRef: "a", anchorY: 1.5 }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("slots[0]: anchorY must be between 0 and 1 (got 1.5)");
  });

  test("re-layout: clip not found — exact message", async () => {
    const ctx = harness();
    const r = await spec.run({ layout: "side_by_side", slots: [{ slot: "left", clipIds: ["ghost"] }, { slot: "right", clipIds: ["cx"] }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("slot 'left': clip not found: ghost");
  });

  test("re-layout: clip wrong type — exact message", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const tl = timeline([
      track("t1", [baseClip("cx", { mediaRef: "a" })]),
      track("t2", [baseClip("cy", { mediaRef: "b", mediaType: "audio", sourceClipType: "audio" })], "audio"),
    ]);
    const ctx = makeCtx(new EditorStore(tl), manifest);
    const r = await spec.run({ layout: "side_by_side", slots: [{ slot: "left", clipIds: ["cx"] }, { slot: "right", clipIds: ["cy"] }] }, ctx);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe("slot 'right': clip cy is audio; layout applies to video/image clips.");
  });
});

// ── placement mode ──────────────────────────────────────────────────────────

describe("apply_layout — placement mode", () => {
  test("side_by_side fills without stretch: centerX 0.25/0.75, symmetric crop", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const store = new EditorStore(timeline([]));
    const ctx = makeCtx(store, manifest);
    const r = await spec.run(
      { layout: "side_by_side", durationFrames: 120, slots: [{ slot: "left", mediaRef: "a" }, { slot: "right", mediaRef: "b" }] },
      ctx,
    );
    expect(r.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks).toHaveLength(2);
    const left = clipsWithMediaRef(tl, "a")[0]!;
    const right = clipsWithMediaRef(tl, "b")[0]!;
    expect(left.transform.centerX).toBeCloseTo(0.25);
    expect(right.transform.centerX).toBeCloseTo(0.75);
    for (const c of [left, right]) {
      expect(c.crop.left).toBeCloseTo(0.25);
      expect(c.crop.right).toBeCloseTo(0.25);
      expect(c.durationFrames).toBe(120);
      expect(c.startFrame).toBe(0);
    }
  });

  test("pip inset sits on top of main: tracks created at index 0 in z order", async () => {
    const manifest = manifestOf(assetEntry("screen"), assetEntry("cam"));
    const store = new EditorStore(timeline([]));
    const ctx = makeCtx(store, manifest);
    const r = await spec.run(
      { layout: "pip_bottom_right", durationFrames: 90, slots: [{ slot: "main", mediaRef: "screen" }, { slot: "inset", mediaRef: "cam" }] },
      ctx,
    );
    expect(r.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks).toHaveLength(2);
    const insetClip = clipsWithMediaRef(tl, "cam")[0]!;
    const mainClip = clipsWithMediaRef(tl, "screen")[0]!;
    const insetTrackIdx = tl.tracks.findIndex((t) => t.clips.some((c) => c.id === insetClip.id));
    const mainTrackIdx = tl.tracks.findIndex((t) => t.clips.some((c) => c.id === mainClip.id));
    expect(insetTrackIdx).toBeLessThan(mainTrackIdx); // higher z (inset) ends up on the higher (lower-index) track
    expect(insetClip.transform.width).toBeCloseTo(0.28);
    expect(insetClip.transform.centerX - insetClip.transform.width / 2).toBeGreaterThan(0.6);
    expect(insetClip.transform.centerY - insetClip.transform.height / 2).toBeGreaterThan(0.6);
  });

  test("fit letterboxes without cropping", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const store = new EditorStore(timeline([]));
    const ctx = makeCtx(store, manifest);
    const r = await spec.run(
      { layout: "top_bottom", durationFrames: 60, fit: "fit", slots: [{ slot: "top", mediaRef: "a" }, { slot: "bottom", mediaRef: "b" }] },
      ctx,
    );
    expect(r.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    for (const c of tl.tracks.flatMap((t) => t.clips)) {
      expect(c.crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
      expect(c.transform.height).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  test("grid_2x2 fills four slots", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"), assetEntry("c"), assetEntry("d"));
    const store = new EditorStore(timeline([]));
    const ctx = makeCtx(store, manifest);
    const r = await spec.run(
      {
        layout: "grid_2x2",
        durationFrames: 90,
        slots: [
          { slot: "top_left", mediaRef: "a" },
          { slot: "top_right", mediaRef: "b" },
          { slot: "bottom_left", mediaRef: "c" },
          { slot: "bottom_right", mediaRef: "d" },
        ],
      },
      ctx,
    );
    expect(r.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    const clips = tl.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(4);
    for (const c of clips) {
      expect(c.transform.width).toBeCloseTo(0.5);
      expect(c.transform.height).toBeCloseTo(0.5);
    }
  });

  // L1 (M13A review, .superpowers/sdd/m13a-broad-review.md): this reducer resolves each slot's
  // audio track inline per-slot, whereas Swift places all video clips first and audio after — the
  // resulting clip/link-group SET is identical either way, but with multiple simultaneous linked-
  // audio placements the physical audio-track *index* a given partner lands on could differ from
  // Swift's. Not asserted here; no behavior change, note-only.
  test("linked audio is placed and is ONE undo step", async () => {
    const manifest = manifestOf(
      assetEntry("a", { hasAudio: true }),
      assetEntry("b", { hasAudio: true }),
    );
    const tl = timeline([track("existing", [baseClip("keep", { mediaRef: "z" })])]);
    const store = new EditorStore(tl);
    const ctx = makeCtx(store, manifest);
    const before = store.getSnapshot().timeline;

    const r = await spec.run(
      { layout: "side_by_side", durationFrames: 60, slots: [{ slot: "left", mediaRef: "a" }, { slot: "right", mediaRef: "b" }] },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(store.canUndo()).toBe(true);

    const afterTl = store.getSnapshot().timeline;
    const videoClips = afterTl.tracks.flatMap((t) => t.clips).filter((c) => c.mediaType === "video" && c.mediaRef !== "z");
    const audioClips = afterTl.tracks.flatMap((t) => t.clips).filter((c) => c.mediaType === "audio");
    expect(videoClips).toHaveLength(2);
    expect(audioClips).toHaveLength(2);
    for (const v of videoClips) {
      expect(v.linkGroupId).toBeDefined();
      const partner = audioClips.find((au) => au.linkGroupId === v.linkGroupId);
      expect(partner).toBeDefined();
      expect(partner!.startFrame).toBe(v.startFrame);
      expect(partner!.durationFrames).toBe(v.durationFrames);
    }

    store.undo();
    expect(store.getSnapshot().timeline).toEqual(before);
    expect(store.canUndo()).toBe(false);
  });

  // M14C T2: apply_layout's media-placement mode inherits the shared resolution auto-match — via
  // the layout's CANONICAL slot order (left, right), not the caller's slots-array order.
  test("adopts resolution from the layout's canonical slot order on an unconfigured timeline; fps untouched", async () => {
    const manifest = manifestOf(
      assetEntry("a", { sourceWidth: 3840, sourceHeight: 2160, sourceFPS: 24 }),
      assetEntry("b", { sourceWidth: 640, sourceHeight: 480 }),
    );
    // settingsConfigured: false (unconfigured) — side_by_side's canonical order is left, right.
    const store = new EditorStore({ ...timeline([]), settingsConfigured: false });
    const ctx = makeCtx(store, manifest);
    // Caller lists "right" (asset b) before "left" (asset a) — canonical order must still win.
    const r = await spec.run(
      { layout: "side_by_side", durationFrames: 60, slots: [{ slot: "right", mediaRef: "b" }, { slot: "left", mediaRef: "a" }] },
      ctx,
    );
    expect(r.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.width).toBe(3840);
    expect(tl.height).toBe(2160);
    expect(tl.fps).toBe(30);
    expect(tl.settingsConfigured).toBe(true);
    const text = r.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("Set timeline to 3840×2160 to match clip.");
  });

  test("configured timeline with existing clips: apply_layout placement does not adopt resolution", async () => {
    const manifest = manifestOf(assetEntry("a", { sourceWidth: 3840, sourceHeight: 2160 }), assetEntry("b"), assetEntry("z"));
    // Non-empty (an unrelated existing clip) + settingsConfigured: true -> checkProjectSettings
    // short-circuits to .proceed before ever looking at resolution.
    const store = new EditorStore(timeline([track("existing", [baseClip("keep", { mediaRef: "z" })])]));
    const ctx = makeCtx(store, manifest);
    const r = await spec.run(
      { layout: "side_by_side", durationFrames: 60, slots: [{ slot: "left", mediaRef: "a" }, { slot: "right", mediaRef: "b" }] },
      ctx,
    );
    expect(r.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.width).toBe(1920);
    expect(tl.height).toBe(1080);
  });
});

// ── re-layout mode ───────────────────────────────────────────────────────────

describe("apply_layout — re-layout mode", () => {
  test("re-layouts existing clips by clipId; timing untouched", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const tl = timeline([
      track("t1", [baseClip("ca", { mediaRef: "a", startFrame: 0, durationFrames: 60 })]),
      track("t2", [baseClip("cb", { mediaRef: "b", startFrame: 0, durationFrames: 60 })]),
    ]);
    const store = new EditorStore(tl);
    const ctx = makeCtx(store, manifest);
    const before = store.getSnapshot().timeline;

    const r = await spec.run({ layout: "side_by_side", slots: [{ slot: "left", clipIds: ["ca"] }, { slot: "right", clipIds: ["cb"] }] }, ctx);
    expect(r.isError).toBe(false);

    const after = store.getSnapshot().timeline;
    expect(after.tracks).toHaveLength(before.tracks.length);
    expect(clipOf(after, "ca").transform.centerX).toBeCloseTo(0.25);
    expect(clipOf(after, "cb").transform.centerX).toBeCloseTo(0.75);
    expect(clipOf(after, "ca").startFrame).toBe(0);
    expect(clipOf(after, "ca").durationFrames).toBe(60);
  });

  test("re-layouts a batch of clips into one slot", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const tl = timeline([
      track("t1", [
        baseClip("ca", { mediaRef: "a", startFrame: 0, durationFrames: 60 }),
        baseClip("cb", { mediaRef: "a", startFrame: 60, durationFrames: 60 }),
      ]),
      track("t2", [baseClip("cc", { mediaRef: "b", startFrame: 0, durationFrames: 120 })]),
    ]);
    const store = new EditorStore(tl);
    const ctx = makeCtx(store, manifest);
    const r = await spec.run(
      { layout: "side_by_side", slots: [{ slot: "left", clipIds: ["ca", "cb"] }, { slot: "right", clipIds: ["cc"] }] },
      ctx,
    );
    expect(r.isError).toBe(false);
    const after = store.getSnapshot().timeline;
    expect(clipOf(after, "ca").transform.centerX).toBeCloseTo(0.25);
    expect(clipOf(after, "cb").transform.centerX).toBeCloseTo(0.25);
    expect(clipOf(after, "cc").transform.centerX).toBeCloseTo(0.75);
  });

  test("rejects same-track overlap across different slots; nothing changes", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const tl = timeline([
      track("t1", [
        baseClip("ca", { mediaRef: "a", startFrame: 0, durationFrames: 60 }),
        baseClip("cb", { mediaRef: "b", startFrame: 30, durationFrames: 60 }),
      ]),
    ]);
    const store = new EditorStore(tl);
    const ctx = makeCtx(store, manifest);
    const r = await spec.run({ layout: "side_by_side", slots: [{ slot: "left", clipIds: ["ca"] }, { slot: "right", clipIds: ["cb"] }] }, ctx);
    expect(r.isError).toBe(true);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe(
      "clips in slots 'left' and 'right' are on the same track and their times overlap; only the first would render. Move them to separate tracks (or place new clips with mediaRef) so every region shows.",
    );
    expect(clipOf(store.getSnapshot().timeline, "ca").transform.centerX).toBeCloseTo(0.5);
    expect(store.canUndo()).toBe(false);
  });

  test("rejects clips that never coincide in time", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const tl = timeline([
      track("t1", [baseClip("ca", { mediaRef: "a", startFrame: 0, durationFrames: 60 })]),
      track("t2", [baseClip("cb", { mediaRef: "b", startFrame: 120, durationFrames: 60 })]),
    ]);
    const store = new EditorStore(tl);
    const ctx = makeCtx(store, manifest);
    const r = await spec.run({ layout: "side_by_side", slots: [{ slot: "left", clipIds: ["ca"] }, { slot: "right", clipIds: ["cb"] }] }, ctx);
    expect(r.isError).toBe(true);
    const text = r.blocks[0]!.kind === "text" ? r.blocks[0]!.text : "";
    expect(text).toBe(
      "the selected clips never play at the same time, so no single frame shows every region. Overlap their timeline ranges (or place new clips with mediaRef) before laying them out.",
    );
    expect(store.canUndo()).toBe(false);
  });

  test("clears the 4 keyframe tracks and leaves every other field byte-equal", async () => {
    const manifest = manifestOf(assetEntry("a"), assetEntry("b"));
    const original: Clip = baseClip("ca", {
      mediaRef: "a",
      startFrame: 0,
      durationFrames: 60,
      volume: 0.4,
      speed: 1.5,
      opacity: 0.8,
      fadeInFrames: 5,
      fadeOutFrames: 7,
      positionTrack: { keyframes: [
        { frame: 0, value: { a: 0, b: 0 }, interpolationOut: "linear" },
        { frame: 60, value: { a: 0.5, b: 0.5 }, interpolationOut: "linear" },
      ] },
      scaleTrack: { keyframes: [
        { frame: 0, value: { a: 1, b: 1 }, interpolationOut: "linear" },
        { frame: 60, value: { a: 0.5, b: 0.5 }, interpolationOut: "linear" },
      ] },
      rotationTrack: { keyframes: [
        { frame: 0, value: 0, interpolationOut: "linear" },
        { frame: 60, value: 90, interpolationOut: "linear" },
      ] },
      cropTrack: { keyframes: [
        { frame: 0, value: defaultCrop(), interpolationOut: "linear" },
        { frame: 60, value: { left: 0.5, top: 0, right: 0, bottom: 0 }, interpolationOut: "linear" },
      ] },
    });
    const tl = timeline([
      track("t1", [original]),
      track("t2", [baseClip("cb", { mediaRef: "b", startFrame: 0, durationFrames: 60 })]),
    ]);
    const store = new EditorStore(tl);
    const ctx = makeCtx(store, manifest);
    const r = await spec.run({ layout: "side_by_side", slots: [{ slot: "left", clipIds: ["ca"] }, { slot: "right", clipIds: ["cb"] }] }, ctx);
    expect(r.isError).toBe(false);

    const after = clipOf(store.getSnapshot().timeline, "ca");
    expect(after.positionTrack).toBeUndefined();
    expect(after.scaleTrack).toBeUndefined();
    expect(after.rotationTrack).toBeUndefined();
    expect(after.cropTrack).toBeUndefined();
    // transformAt/frame sampling now falls back to the static transform (tracks cleared)
    expect(transformAt(after, 0).centerX).toBeCloseTo(0.25);
    expect(transformAt(after, 60).centerX).toBeCloseTo(0.25);

    // every other field is byte-equal to the original
    const { transform: _t, crop: _c, positionTrack: _p, scaleTrack: _s, rotationTrack: _r, cropTrack: _k, ...restAfter } = after;
    const { transform: _t2, crop: _c2, positionTrack: _p2, scaleTrack: _s2, rotationTrack: _r2, cropTrack: _k2, ...restBefore } = original;
    expect(restAfter).toEqual(restBefore);
  });
});

