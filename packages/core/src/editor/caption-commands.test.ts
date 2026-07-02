import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { defaultTextStyle } from "../text-style.js";
import type { CaptionClipSpec } from "../captions/caption-mapper.js";
import { EditorStore } from "./editor-store.js";
import { placeCaptionsCommand } from "./caption-commands.js";

function track(id: string, type: Track["type"], clips: Clip[] = []): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

function baseClip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame: 0, durationFrames: 90, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    ...over,
  };
}

function spec(over: Partial<CaptionClipSpec> = {}): CaptionClipSpec {
  return {
    content: "hello world",
    startFrame: 10,
    durationFrames: 20,
    wordTimings: [
      { text: "hello", startFrame: 0, endFrame: 10 },
      { text: "world", startFrame: 10, endFrame: 20 },
    ],
    ...over,
  };
}

function counter(): () => string {
  let n = 0;
  return () => `id-${n++}`;
}

describe("placeCaptionsCommand", () => {
  it("inserts a new video track at index 0", () => {
    const tl = timeline([track("v0", "video", [baseClip("c1")]), track("a0", "audio")]);
    const cmd = placeCaptionsCommand({
      specs: [spec()],
      style: defaultTextStyle(),
      captionGroupId: "grp",
      newId: counter(),
    });
    const next = cmd.apply(tl);
    expect(next.tracks).toHaveLength(3);
    expect(next.tracks[0]!.type).toBe("video");
    expect(next.tracks[0]!.clips).toHaveLength(1);
    // Original tracks preserved, shifted down.
    expect(next.tracks[1]!.id).toBe("v0");
    expect(next.tracks[2]!.id).toBe("a0");
  });

  it("places every spec as a text clip carrying content/style/animation/wordTimings/captionGroupId", () => {
    const tl = timeline([]);
    const style = { ...defaultTextStyle(), fontSize: 48 };
    const cmd = placeCaptionsCommand({
      specs: [spec({ content: "hi there" })],
      style,
      animation: { preset: "wordReveal", highlightColor: { r: 1, g: 0, b: 0, a: 1 } },
      captionGroupId: "grp-1",
      newId: counter(),
    });
    const next = cmd.apply(tl);
    const clip = next.tracks[0]!.clips[0]!;
    expect(clip.mediaType).toBe("text");
    expect(clip.sourceClipType).toBe("text");
    expect(clip.textContent).toBe("hi there");
    expect(clip.textStyle).toEqual(style);
    expect(clip.textAnimation).toEqual({ preset: "wordReveal", highlightColor: { r: 1, g: 0, b: 0, a: 1 } });
    expect(clip.wordTimings).toEqual([
      { text: "hello", startFrame: 0, endFrame: 10 },
      { text: "world", startFrame: 10, endFrame: 20 },
    ]);
    expect(clip.captionGroupId).toBe("grp-1");
    expect(clip.startFrame).toBe(10);
    expect(clip.durationFrames).toBe(20);
  });

  it("centers the transform at (0.5, 0.9) by default, overridable via centerX/centerY", () => {
    const tl = timeline([]);
    const defaultCmd = placeCaptionsCommand({ specs: [spec()], style: defaultTextStyle(), captionGroupId: "g", newId: counter() });
    const defaultClip = defaultCmd.apply(tl).tracks[0]!.clips[0]!;
    expect(defaultClip.transform).toEqual({ centerX: 0.5, centerY: 0.9, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false });

    const customCmd = placeCaptionsCommand({
      specs: [spec()], style: defaultTextStyle(), captionGroupId: "g", newId: counter(), centerX: 0.3, centerY: 0.2,
    });
    const customClip = customCmd.apply(tl).tracks[0]!.clips[0]!;
    expect(customClip.transform.centerX).toBe(0.3);
    expect(customClip.transform.centerY).toBe(0.2);
  });

  it("places multiple specs as multiple clips, sorted by startFrame, on the SAME new track", () => {
    const tl = timeline([]);
    const cmd = placeCaptionsCommand({
      specs: [spec({ content: "second", startFrame: 50, durationFrames: 10 }), spec({ content: "first", startFrame: 5, durationFrames: 10 })],
      style: defaultTextStyle(),
      captionGroupId: "grp",
      newId: counter(),
    });
    const next = cmd.apply(tl);
    expect(next.tracks).toHaveLength(1);
    const clips = next.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    expect(clips.map((c) => c.textContent)).toEqual(["first", "second"]);
    // Distinct ids, both carrying the shared group id.
    expect(new Set(clips.map((c) => c.id)).size).toBe(2);
    expect(clips.every((c) => c.captionGroupId === "grp")).toBe(true);
  });

  it("is re-runnable: two independent applies against the same starting timeline are identical", () => {
    const tl = timeline([track("v0", "video", [baseClip("c1")])]);
    const cmd = placeCaptionsCommand({
      specs: [spec({ startFrame: 5 }), spec({ startFrame: 40 })],
      style: defaultTextStyle(),
      captionGroupId: "grp",
      newId: counter(),
    });
    const first = cmd.apply(tl);
    const second = cmd.apply(tl);
    expect(second).toEqual(first);
    // Same ids both times (not freshly minted per apply).
    expect(second.tracks[0]!.id).toBe(first.tracks[0]!.id);
    expect(second.tracks[0]!.clips.map((c) => c.id)).toEqual(first.tracks[0]!.clips.map((c) => c.id));
  });

  it("one undo restores everything (track + clips) via EditorStore", () => {
    const tl = timeline([track("v0", "video", [baseClip("c1")])]);
    const store = new EditorStore(tl);
    const cmd = placeCaptionsCommand({
      specs: [spec(), spec({ startFrame: 40 })],
      style: defaultTextStyle(),
      captionGroupId: "grp",
      newId: counter(),
    });
    store.dispatch(cmd);
    expect(store.getSnapshot().timeline.tracks).toHaveLength(2);
    expect(store.canUndo()).toBe(true);

    store.undo();
    const restored = store.getSnapshot().timeline;
    expect(restored.tracks).toHaveLength(1);
    expect(restored.tracks[0]!.id).toBe("v0");
    expect(store.canUndo()).toBe(false);
  });
});
