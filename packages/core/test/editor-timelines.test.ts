import { describe, expect, test } from "vitest";
import { EditorStore } from "../src/editor/editor-store.js";
import { defaultTimeline } from "../src/timeline.js";
import { changeTimelineMarkersCommand } from "../src/editor/marker-commands.js";
import { defaultTimelineMarker } from "../src/timeline-marker.js";

describe("EditorStore multiple timelines", () => {
  test("createTimeline switches to an empty copy of fps/size", () => {
    const store = new EditorStore({ ...defaultTimeline(), fps: 24, width: 1080, height: 1920 });
    const id = store.createTimeline("B-roll");
    const snap = store.getSnapshot();
    expect(snap.timelines).toHaveLength(2);
    expect(snap.activeTimelineId).toBe(id);
    expect(snap.timeline.name).toBe("B-roll");
    expect(snap.timeline.fps).toBe(24);
    expect(snap.timeline.tracks).toHaveLength(0);
  });

  test("undo createTimeline restores the single timeline", () => {
    const store = new EditorStore(defaultTimeline());
    const original = store.getSnapshot().activeTimelineId;
    store.createTimeline("Alt");
    store.undo();
    expect(store.getSnapshot().timelines).toHaveLength(1);
    expect(store.getSnapshot().activeTimelineId).toBe(original);
  });

  test("duplicateTimeline regenerates clip ids", () => {
    const store = new EditorStore({
      ...defaultTimeline(),
      tracks: [
        {
          id: "t1",
          type: "video",
          muted: false,
          hidden: false,
          syncLocked: true,
          clips: [
            {
              id: "c1",
              mediaRef: "m1",
              mediaType: "video",
              sourceClipType: "video",
              startFrame: 0,
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
              transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
            },
          ],
        },
      ],
    });
    const sourceId = store.getSnapshot().activeTimelineId;
    const copyId = store.duplicateTimeline(sourceId)!;
    const copy = store.timelineById(copyId)!;
    expect(copy.tracks[0]!.clips[0]!.id).not.toBe("c1");
    expect(store.timelineById(sourceId)!.tracks[0]!.clips[0]!.id).toBe("c1");
  });

  test("cannot delete the last timeline", () => {
    const store = new EditorStore(defaultTimeline());
    expect(store.deleteTimeline(store.getSnapshot().activeTimelineId)).toBe(false);
    expect(store.getSnapshot().timelines).toHaveLength(1);
  });

  test("marker create is undoable on the active timeline", () => {
    const store = new EditorStore(defaultTimeline());
    const marker = defaultTimelineMarker({ name: "Hit", startFrame: 12 });
    store.dispatch(changeTimelineMarkersCommand({ creates: [marker] }, "Add Marker"));
    expect(store.getSnapshot().timeline.markers).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().timeline.markers ?? []).toHaveLength(0);
  });
});
