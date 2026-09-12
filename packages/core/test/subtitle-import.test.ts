import { describe, expect, test } from "vitest";
import {
  captionSpecsFromCues,
  defaultCaptionTextStyle,
  defaultTextStyle,
  placeSubtitleCaptionsCommand,
  EditorStore,
  defaultTimeline,
  type SubtitleCue,
  type Track,
  type Clip,
} from "../src/index.js";

describe("captionSpecsFromCues", () => {
  test("converts cue seconds to frames, clamping sub-frame cues to 1 frame", () => {
    const specs = captionSpecsFromCues(
      [
        { text: "one", startSec: 1.0, endSec: 2.5 },
        { text: "blip", startSec: 3.0, endSec: 3.01 },
      ],
      30,
    );
    expect(specs.map((s) => s.startFrame)).toEqual([30, 90]);
    expect(specs.map((s) => s.durationFrames)).toEqual([45, 1]);
    expect(specs.map((s) => s.content)).toEqual(["one", "blip"]);
  });

  test("resolves overlaps without closing gaps", () => {
    const cues: SubtitleCue[] = [
      { text: "overlapping", startSec: 0, endSec: 1.0 },
      { text: "next", startSec: 0.9, endSec: 2.0 },
      { text: "after gap", startSec: 2.2, endSec: 3.0 },
    ];
    const specs = captionSpecsFromCues(cues, 30);
    expect(specs.map((s) => s.startFrame)).toEqual([0, 27, 66]);
    expect(specs.map((s) => s.durationFrames)).toEqual([27, 33, 24]);
  });
});

describe("placeSubtitleCaptionsCommand", () => {
  test("places cues as one caption group on a new top track, one undo step", () => {
    const video: Track = {
      id: "v0",
      type: "video",
      muted: false,
      hidden: false,
      syncLocked: false,
      clips: [],
    };
    const store = new EditorStore({ ...defaultTimeline(), tracks: [video] });
    let n = 0;
    const cmd = placeSubtitleCaptionsCommand({
      cues: [
        { text: "Hello.", startSec: 1, endSec: 2 },
        { text: "World.", startSec: 3, endSec: 4 },
      ],
      fps: 30,
      captionGroupId: "g1",
      newId: () => `id-${n++}`,
    });
    store.dispatch(cmd);

    const tracks = store.getSnapshot().timeline.tracks;
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.type).toBe("video");
    const captions: Clip[] = tracks[0]!.clips;
    expect(captions.map((c) => c.textContent)).toEqual(["Hello.", "World."]);
    expect(captions.map((c) => c.startFrame)).toEqual([30, 90]);
    expect(captions.every((c) => c.mediaType === "text" && c.captionGroupId === "g1")).toBe(true);
    expect(captions[0]!.textStyle?.fontSize).toBe(defaultCaptionTextStyle().fontSize);
    expect(captions[0]!.textStyle?.fontSize).not.toBe(defaultTextStyle().fontSize);

    store.undo();
    expect(store.getSnapshot().timeline.tracks).toHaveLength(1);
    expect(store.getSnapshot().timeline.tracks[0]!.id).toBe("v0");
  });
});
