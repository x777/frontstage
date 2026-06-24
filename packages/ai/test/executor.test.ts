import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
} from "@palmier/core";
import type { Timeline, Track } from "@palmier/core";
import {
  ToolExecutor,
  asUndoStep,
  ok,
  errorResult,
  type ToolSpec,
  type ToolContext,
} from "../src/index.js";

function makeCtx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => crypto.randomUUID(),
  };
}

function makeTrack(id = "t1"): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips: [] };
}

const noopSchema = z.object({});

describe("ok / errorResult helpers", () => {
  test("ok returns isError:false with text block", () => {
    const r = ok("hello");
    expect(r.isError).toBe(false);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toEqual({ kind: "text", text: "hello" });
  });

  test("errorResult returns isError:true with text block", () => {
    const r = errorResult("bad");
    expect(r.isError).toBe(true);
    expect(r.blocks[0]).toEqual({ kind: "text", text: "bad" });
  });
});

describe("asUndoStep", () => {
  test("two reducers bundled into ONE undo entry", () => {
    const tl = { ...defaultTimeline(), tracks: [makeTrack()] };
    const store = new EditorStore(tl);

    // reducer 1: add track t2
    const r1 = (t: Timeline): Timeline => ({
      ...t,
      tracks: [...t.tracks, { id: "t2", type: "audio" as const, muted: false, hidden: false, syncLocked: false, clips: [] }],
    });
    // reducer 2: set fps to 60
    const r2 = (t: Timeline): Timeline => ({ ...t, fps: 60 });

    asUndoStep(store, "bundle", [r1, r2]);

    const snap = store.getSnapshot();
    expect(snap.timeline.tracks).toHaveLength(2);
    expect(snap.timeline.fps).toBe(60);

    // exactly ONE undo entry
    expect(store.canUndo()).toBe(true);

    store.undo();
    const after = store.getSnapshot();
    // both mutations reverted
    expect(after.timeline.tracks).toHaveLength(1);
    expect(after.timeline.fps).toBe(30);

    // no more undo entries (only one step was dispatched)
    expect(store.canUndo()).toBe(false);
  });
});

describe("ToolExecutor", () => {
  test("list() returns all specs", () => {
    const spec: ToolSpec = {
      name: "my_tool",
      description: "does a thing",
      inputSchema: noopSchema,
      run: () => ok("ok"),
    };
    const store = new EditorStore(defaultTimeline());
    const ctx = makeCtx(store);
    const ex = new ToolExecutor([spec], ctx);
    const list = ex.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("my_tool");
  });

  test("unknown tool name returns errorResult, does not throw", async () => {
    const store = new EditorStore(defaultTimeline());
    const ex = new ToolExecutor([], makeCtx(store));
    const result = await ex.execute("nope", {});
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toMatchObject({ kind: "text", text: expect.stringContaining("nope") });
  });

  test("schema mismatch returns errorResult, does not throw", async () => {
    const spec: ToolSpec = {
      name: "strict",
      description: "needs name",
      inputSchema: z.object({ name: z.string() }),
      run: () => ok("ok"),
    };
    const store = new EditorStore(defaultTimeline());
    const ex = new ToolExecutor([spec], makeCtx(store));
    const result = await ex.execute("strict", { name: 42 });
    expect(result.isError).toBe(true);
  });

  test("throwing tool returns errorResult, execute does not throw", async () => {
    const spec: ToolSpec = {
      name: "exploder",
      description: "always throws",
      inputSchema: noopSchema,
      run: () => { throw new Error("kaboom"); },
    };
    const store = new EditorStore(defaultTimeline());
    const ex = new ToolExecutor([spec], makeCtx(store));
    let result: Awaited<ReturnType<typeof ex.execute>> | undefined;
    await expect(async () => {
      result = await ex.execute("exploder", {});
    }).not.toThrow();
    expect(result!.isError).toBe(true);
    expect(result!.blocks[0]).toMatchObject({ kind: "text", text: expect.stringContaining("kaboom") });
  });

  test("asUndoStep via tool run produces exactly ONE undo entry", async () => {
    const tl = defaultTimeline();
    const store = new EditorStore(tl);

    const spec: ToolSpec = {
      name: "mutate",
      description: "mutates via asUndoStep",
      inputSchema: noopSchema,
      run(_args, ctx) {
        asUndoStep(ctx.store, "double-mutate", [
          (t) => ({ ...t, fps: 60 }),
          (t) => ({ ...t, width: 3840 }),
        ]);
        return ok("done");
      },
    };

    const ex = new ToolExecutor([spec], makeCtx(store));
    const result = await ex.execute("mutate", {});
    expect(result.isError).toBe(false);

    const snap = store.getSnapshot();
    expect(snap.timeline.fps).toBe(60);
    expect(snap.timeline.width).toBe(3840);

    expect(store.canUndo()).toBe(true);
    store.undo();
    const after = store.getSnapshot();
    expect(after.timeline.fps).toBe(30);
    expect(after.timeline.width).toBe(1920);
    expect(store.canUndo()).toBe(false);
  });
});
