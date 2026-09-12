import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline } from "@frontstage/core";
import { ToolExecutor, type ToolContext } from "../src/index.js";
import { createTimelineTool, setActiveTimelineTool, manageMarkersTool } from "../src/tools/timeline-tools.js";

function ctx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => crypto.randomUUID(),
  };
}

describe("timeline tools", () => {
  test("create_timeline then set_active_timeline round-trips", async () => {
    const store = new EditorStore(defaultTimeline());
    const first = store.getSnapshot().activeTimelineId;
    const exec = new ToolExecutor([createTimelineTool(), setActiveTimelineTool(), manageMarkersTool()], ctx(store));
    const created = await exec.execute("create_timeline", { name: "Alt" });
    expect(created.isError).toBe(false);
    const payload = JSON.parse(created.blocks[0]!.kind === "text" ? created.blocks[0]!.text : "{}");
    expect(payload.name).toBe("Alt");
    expect(store.getSnapshot().activeTimelineId).toBe(payload.timelineId);

    const switched = await exec.execute("set_active_timeline", { timelineId: first });
    expect(switched.isError).toBe(false);
    expect(store.getSnapshot().activeTimelineId).toBe(first);
  });

  test("manage_markers create/update/delete", async () => {
    const store = new EditorStore(defaultTimeline());
    const exec = new ToolExecutor([manageMarkersTool()], ctx(store));
    const created = await exec.execute("manage_markers", { action: "create", name: "Beat", startFrame: 10 });
    expect(created.isError).toBe(false);
    const id = JSON.parse(created.blocks[0]!.kind === "text" ? created.blocks[0]!.text : "{}").created.markerId as string;
    expect(store.getSnapshot().timeline.markers![0]!.name).toBe("Beat");

    const updated = await exec.execute("manage_markers", { action: "update", markerId: id, status: "review" });
    expect(updated.isError).toBe(false);
    expect(store.getSnapshot().timeline.markers![0]!.status).toBe("review");

    const deleted = await exec.execute("manage_markers", { action: "delete", markerId: id });
    expect(deleted.isError).toBe(false);
    expect(store.getSnapshot().timeline.markers ?? []).toHaveLength(0);
  });
});
