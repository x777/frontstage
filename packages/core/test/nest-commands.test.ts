import { describe, expect, test } from "vitest";
import { EditorStore } from "../src/editor/editor-store.js";
import { nestBlockReason, nestTimelineCommand, planDecomposeNest, wouldCreateNestCycle } from "../src/editor/nest-commands.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import { defaultTimeline, type Timeline, type Track } from "../src/timeline.js";
import type { Clip } from "../src/clip.js";

function clip(over: Partial<Clip> & { id: string; mediaType: Clip["mediaType"] }): Clip {
  return {
    mediaRef: "m1",
    sourceClipType: over.mediaType,
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

function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function childWithAV(id = "child"): Timeline {
  return {
    ...defaultTimeline(),
    id,
    name: "Intro",
    tracks: [
      track("v", "video", [clip({ id: "cv", mediaType: "video", durationFrames: 60 })]),
      track("a", "audio", [clip({ id: "ca", mediaType: "audio", durationFrames: 60 })]),
    ],
  };
}

describe("nestTimelineCommand", () => {
  test("places a sequence clip with linked audio and undoes", () => {
    const child = childWithAV();
    const parent: Timeline = { ...defaultTimeline(), id: "parent", name: "Parent", tracks: [] };
    const store = new EditorStore(parent);
    const before = store.getSnapshot().timeline;
    store.dispatch(nestTimelineCommand(child, 30, { kind: "new", index: 0 }, (() => {
      let n = 0;
      return () => `n${++n}`;
    })()));

    const tl = store.getSnapshot().timeline;
    const video = tl.tracks.find((t) => t.type === "video")!.clips[0]!;
    const audio = tl.tracks.find((t) => t.type === "audio")!.clips[0]!;
    expect(video.mediaType).toBe("sequence");
    expect(video.sourceClipType).toBe("sequence");
    expect(video.mediaRef).toBe(child.id);
    expect(video.startFrame).toBe(30);
    expect(video.durationFrames).toBe(60);
    expect(audio.mediaType).toBe("audio");
    expect(audio.sourceClipType).toBe("sequence");
    expect(audio.linkGroupId).toBe(video.linkGroupId);
    expect(audio.linkGroupId).toBeDefined();

    store.undo();
    expect(store.getSnapshot().timeline.tracks.every((t) => t.clips.length === 0)).toBe(true);
    expect(before.tracks.every((t) => t.clips.length === 0)).toBe(true);
  });

  test("empty child is a no-op", () => {
    const empty: Timeline = { ...defaultTimeline(), id: "empty", name: "Empty", tracks: [] };
    const parent: Timeline = { ...defaultTimeline(), id: "parent", tracks: [] };
    const next = nestTimelineCommand(empty, 0, { kind: "new", index: 0 }).apply(parent);
    expect(next).toBe(parent);
  });
});

describe("nestBlockReason / cycle", () => {
  test("rejects empty and self/cycle", () => {
    const empty: Timeline = { ...defaultTimeline(), id: "empty", name: "Empty", tracks: [] };
    const host: Timeline = {
      ...defaultTimeline(),
      id: "host",
      name: "Host",
      tracks: [track("v", "video", [clip({ id: "c", mediaType: "video", durationFrames: 30 })])],
    };
    const resolve = (id: string) => (id === empty.id ? empty : id === host.id ? host : undefined);
    expect(nestBlockReason(empty, host.id!, resolve)).toMatch(/empty/);
    expect(nestBlockReason(host, host.id!, resolve)).toMatch(/contain itself/);

    const child = childWithAV("b");
    const aWithB: Timeline = {
      ...host,
      id: "a",
      tracks: [
        track("v", "video", [
          clip({ id: "nest", mediaType: "sequence", sourceClipType: "sequence", mediaRef: "b", durationFrames: 60 }),
        ]),
      ],
    };
    const timelines = new Map<string, Timeline>([
      ["a", aWithB],
      ["b", child],
    ]);
    const r = (id: string) => timelines.get(id);
    expect(wouldCreateNestCycle("a", "b", r)).toBe(true);
    expect(nestBlockReason(aWithB, "b", r)).toMatch(/contain itself/);
  });
});

describe("planNestSelectedClips", () => {
  test("moves selection into a new timeline with linked carriers", () => {
    const parent: Timeline = {
      ...defaultTimeline(),
      id: "host",
      tracks: [
        track("t0", "video", [
          clip({ id: "t1", mediaType: "video", startFrame: 0, durationFrames: 20 }),
          clip({ id: "t2", mediaType: "video", startFrame: 40, durationFrames: 20 }),
        ]),
        track("t1", "video", [clip({ id: "v1", mediaType: "video", startFrame: 30, durationFrames: 60 })]),
        track("t2", "audio", [
          clip({ id: "a1", mediaType: "audio", startFrame: 30, durationFrames: 30 }),
          clip({ id: "a2", mediaType: "audio", startFrame: 100, durationFrames: 10 }),
        ]),
      ],
    };
    const before = parent;
    const store = new EditorStore(parent);
    store.select(["t2", "v1", "a1"]);
    expect(store.nestSelectedClips()).toBe(true);

    const child = store.getSnapshot().timelines.find((t) => t.name === "Nest 1");
    expect(child).toBeDefined();
    expect(child!.tracks.map((t) => t.type)).toEqual(["video", "video", "audio"]);
    expect(child!.tracks[0]!.clips.map((c) => c.startFrame)).toEqual([10]);
    expect(child!.tracks[1]!.clips.map((c) => c.startFrame)).toEqual([0]);
    expect(child!.tracks[2]!.clips.map((c) => c.startFrame)).toEqual([0]);

    const tl = store.getSnapshot().timeline;
    expect(tl.tracks.length).toBe(2);
    const v = tl.tracks.find((t) => t.type === "video")!.clips.find((c) => c.sourceClipType === "sequence");
    const a = tl.tracks.find((t) => t.type === "audio")!.clips.find((c) => c.sourceClipType === "sequence");
    expect(v?.startFrame).toBe(30);
    expect(v?.durationFrames).toBe(60);
    expect(a?.mediaType).toBe("audio");
    expect(v?.linkGroupId).toBeDefined();
    expect(v?.linkGroupId).toBe(a?.linkGroupId);
    expect(tl.tracks[0]!.clips.some((c) => c.id === "t1")).toBe(true);
    expect(tl.tracks[1]!.clips.some((c) => c.id === "a2")).toBe(true);

    store.undo();
    expect(store.getSnapshot().timeline.tracks.map((t) => t.clips.map((c) => c.id))).toEqual(
      before.tracks.map((t) => t.clips.map((c) => c.id)),
    );
    expect(store.getSnapshot().timelines).toHaveLength(1);
  });

  test("keeps an unselected clip inside the nest span", () => {
    const parent: Timeline = {
      ...defaultTimeline(),
      tracks: [
        track("v", "video", [
          clip({ id: "s1", mediaType: "video", startFrame: 0, durationFrames: 20 }),
          clip({ id: "mid", mediaType: "video", startFrame: 30, durationFrames: 20 }),
          clip({ id: "s2", mediaType: "video", startFrame: 60, durationFrames: 20 }),
        ]),
      ],
    };
    const store = new EditorStore(parent);
    store.select(["s1", "s2"]);
    store.nestSelectedClips();
    const all = store.getSnapshot().timeline.tracks.flatMap((t) => t.clips);
    expect(all.some((c) => c.id === "mid")).toBe(true);
    const carrier = all.find((c) => c.sourceClipType === "sequence");
    expect(carrier?.startFrame).toBe(0);
    expect(carrier?.durationFrames).toBe(80);
    expect(store.getSnapshot().timeline.tracks.length).toBe(2);
  });

  test("regenerates group ids in the child when a link group is split", () => {
    const parent: Timeline = {
      ...defaultTimeline(),
      tracks: [
        track("v", "video", [clip({ id: "v", mediaType: "video", durationFrames: 30, linkGroupId: "g1" })]),
        track("a", "audio", [clip({ id: "a", mediaType: "audio", durationFrames: 30, linkGroupId: "g1" })]),
      ],
    };
    const store = new EditorStore(parent);
    store.select(["v"]);
    store.nestSelectedClips();
    const child = store.getSnapshot().timelines.find((t) => t.name === "Nest 1")!;
    const moved = child.tracks.flatMap((t) => t.clips)[0];
    expect(moved).toBeDefined();
    expect(moved!.linkGroupId).not.toBe("g1");
    expect(store.getSnapshot().timeline.tracks.flatMap((t) => t.clips).some((c) => c.id === "a" && c.linkGroupId === "g1")).toBe(true);
  });
});

describe("planDecomposeNest", () => {
  test("replaces nest with child clips remapped in place", () => {
    const child: Timeline = {
      ...defaultTimeline(),
      id: "child",
      tracks: [
        track("top", "video", [clip({ id: "top", mediaType: "video", startFrame: 10, durationFrames: 20 })]),
        track("cv", "video", [clip({ id: "cv", mediaType: "video", durationFrames: 40, linkGroupId: "g1" })]),
        track("ca", "audio", [clip({ id: "ca", mediaType: "audio", durationFrames: 40, volume: 0.8, linkGroupId: "g1" })]),
      ],
    };
    const parent0: Timeline = { ...defaultTimeline(), id: "parent", tracks: [] };
    let n = 0;
    const newId = () => `d${++n}`;
    let parent = nestTimelineCommand(child, 100, { kind: "new", index: 0 }, newId).apply(parent0);
    parent = {
      ...parent,
      tracks: parent.tracks.map((tr) =>
        tr.type === "audio"
          ? { ...tr, clips: tr.clips.map((c) => (c.sourceClipType === "sequence" ? { ...c, volume: 0.5 } : c)) }
          : tr,
      ),
    };
    const nestId = parent.tracks.find((t) => t.type === "video")!.clips[0]!.id;
    const out = planDecomposeNest(parent, nestId, child, newId);
    expect(out).not.toBeNull();

    const videoTracks = out!.timeline.tracks.filter((t) => t.type === "video");
    const audioTracks = out!.timeline.tracks.filter((t) => t.type === "audio");
    expect(videoTracks.length).toBe(2);
    expect(audioTracks.length).toBe(1);
    expect(videoTracks[0]!.clips.map((c) => c.startFrame)).toEqual([110]);
    expect(videoTracks[1]!.clips.map((c) => c.startFrame)).toEqual([100]);
    expect(audioTracks[0]!.clips.map((c) => c.startFrame)).toEqual([100]);
    const v = videoTracks[1]!.clips[0]!;
    const a = audioTracks[0]!.clips[0]!;
    expect(v.id).not.toBe("cv");
    expect(a.id).not.toBe("ca");
    expect(v.linkGroupId).toBeDefined();
    expect(v.linkGroupId).toBe(a.linkGroupId);
    expect(v.linkGroupId).not.toBe("g1");
    expect(Math.abs(a.volume - 0.8 * 0.5)).toBeLessThan(0.0001);
  });

  test("compose then decompose round-trips leftover clips", () => {
    const parent: Timeline = {
      ...defaultTimeline(),
      tracks: [
        track("cap", "video", [
          clip({ id: "capIntro", mediaType: "video", startFrame: 0, durationFrames: 25 }),
          clip({ id: "cap", mediaType: "video", startFrame: 30, durationFrames: 40 }),
        ]),
        track("v", "video", [
          clip({ id: "vIntro", mediaType: "video", startFrame: 0, durationFrames: 25 }),
          clip({ id: "v", mediaType: "video", startFrame: 30, durationFrames: 60 }),
        ]),
        track("a", "audio", [
          clip({ id: "aIntro", mediaType: "audio", startFrame: 0, durationFrames: 25 }),
          clip({ id: "a", mediaType: "audio", startFrame: 30, durationFrames: 60 }),
        ]),
      ],
    };
    const store = new EditorStore(parent);
    store.select(["cap", "v", "a"]);
    store.nestSelectedClips();
    const carrier = store.getSnapshot().timeline.tracks.flatMap((t) => t.clips).find((c) => c.mediaType === "sequence")!;
    store.decomposeNest(carrier.id);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks.length).toBe(3);
    expect(tl.tracks[0]!.clips.map((c) => c.startFrame)).toEqual([0, 30]);
    expect(tl.tracks[1]!.clips.map((c) => c.startFrame)).toEqual([0, 30]);
    expect(tl.tracks[2]!.clips.map((c) => c.startFrame)).toEqual([0, 30]);
    expect(tl.tracks[1]!.clips[1]!.durationFrames).toBe(60);
    expect(tl.tracks.some((t) => t.clips.length === 0)).toBe(false);
  });
});
