import { describe, expect, test } from "vitest";
import { generateImageTool, ToolExecutor } from "../src/index.js";
import type { ToolContext } from "../src/index.js";
import type { MediaManifestEntry } from "@palmier/core";
import { EditorStore, defaultTimeline } from "@palmier/core";

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  const store = new EditorStore(defaultTimeline());
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => "test-id",
    ...overrides,
  };
}

function makeEntry(): MediaManifestEntry {
  return {
    id: "img-1",
    name: "a cat",
    type: "image",
    source: { kind: "project", relativePath: "media/img-1.png" },
    duration: 5,
  };
}

describe("generate_image tool", () => {
  test("returns non-error result with entry name and id", async () => {
    const tool = generateImageTool();
    const ctx = makeCtx({
      generateImage: async () => makeEntry(),
    });

    const result = await tool.run({ prompt: "a cat" }, ctx);

    expect(result.isError).toBe(false);
    const block = result.blocks[0]; const text = block?.kind === "text" ? block.text : "";
    expect(text).toContain("a cat");
    expect(text).toContain("img-1");
  });

  test("returns isError when ctx.generateImage is absent", async () => {
    const tool = generateImageTool();
    const ctx = makeCtx(); // no generateImage

    const result = await tool.run({ prompt: "a cat" }, ctx);

    expect(result.isError).toBe(true);
    const block = result.blocks[0]; const text = block?.kind === "text" ? block.text : "";
    expect(text).toContain("not available");
  });

  test("returns isError when ctx.generateImage throws", async () => {
    const tool = generateImageTool();
    const ctx = makeCtx({
      generateImage: async () => { throw new Error("network error"); },
    });

    const result = await tool.run({ prompt: "a cat" }, ctx);

    expect(result.isError).toBe(true);
    const block = result.blocks[0]; const text = block?.kind === "text" ? block.text : "";
    expect(text).toContain("image generation failed");
  });

  test("has correct name", () => {
    const tool = generateImageTool();
    expect(tool.name).toBe("generate_image");
  });

  test("rejects empty prompt via executor schema validation", async () => {
    const ctx = makeCtx({
      generateImage: async () => makeEntry(),
    });
    const executor = new ToolExecutor([generateImageTool()], ctx);

    const result = await executor.execute("generate_image", { prompt: "" });
    expect(result.isError).toBe(true);
  });
});
