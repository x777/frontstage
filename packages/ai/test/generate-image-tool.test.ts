import { describe, expect, test } from "vitest";
import { generateImageTool, ToolExecutor } from "../src/index.js";
import type { ToolContext } from "../src/index.js";
import type { MediaManifestEntry } from "@palmier/core";
import { EditorStore, defaultTimeline } from "@palmier/core";
import type { StartJobArgs } from "../src/generation/generation-service.js";

type GenerationFacade = NonNullable<ToolContext["generation"]>;

function makeFacade(overrides?: Partial<GenerationFacade>): {
  facade: GenerationFacade;
  addPlaceholderCalls: MediaManifestEntry[];
  startJobCalls: StartJobArgs[];
} {
  const addPlaceholderCalls: MediaManifestEntry[] = [];
  const startJobCalls: StartJobArgs[] = [];
  const facade: GenerationFacade = {
    hasKey: async () => true,
    addPlaceholder: (entry) => { addPlaceholderCalls.push(entry); },
    startJob: async (args) => { startJobCalls.push(args); return { jobId: "job-1" }; },
    confirmThreshold: 50,
    ...overrides,
  };
  return { facade, addPlaceholderCalls, startJobCalls };
}

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  const store = new EditorStore(defaultTimeline());
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => "test-id",
    ...overrides,
  };
}

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  const block = result.blocks[0];
  return block?.kind === "text" ? (block.text ?? "") : "";
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

// ── generate_image pipeline (fal key configured) ────────────────────────────

describe("generate_image tool — pipeline path", () => {
  test("with numImages: 3, creates 3 placeholders (outputIndex 0/1/2, shared baseName) and one startJob", async () => {
    const tool = generateImageTool();
    let counter = 0;
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => `img-${counter++}` });

    const result = await tool.run({ prompt: "a cat on a skateboard", numImages: 3 }, ctx);

    expect(result.isError).toBe(false);
    expect(addPlaceholderCalls).toHaveLength(3);
    addPlaceholderCalls.forEach((p, i) => {
      expect(p.type).toBe("image");
      expect(p.generationInput?.outputIndex).toBe(i);
      expect(p.generationInput?.prompt).toBe("a cat on a skateboard");
      expect(p.generationInput?.model).toBe("fal-ai/nano-banana"); // default = first image entry
      expect(p.name).toBe(`a cat on a skateboard ${i + 1}`); // prompt is under 24 chars, used verbatim
    });

    expect(startJobCalls).toHaveLength(1);
    const call = startJobCalls[0]!;
    expect(call.modelEndpoint).toBe("fal-ai/nano-banana");
    expect(call.placeholders).toEqual(addPlaceholderCalls);
    // nano-banana: 3.98 credits/image * 3 = 11.94 -> ceil = 12.
    expect(call.costCredits).toBe(12);

    expect(textOf(result)).toContain("img-0"); // the FIRST placeholder id
    expect(textOf(result)).toContain("12 credits");
  });

  test("defaults numImages to 1 and respects an explicit model", async () => {
    const tool = generateImageTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "img-x" });

    await tool.run({ prompt: "a mountain lake", model: "flux-dev" }, ctx);

    expect(addPlaceholderCalls).toHaveLength(1);
    expect(startJobCalls[0]!.modelEndpoint).toBe("fal-ai/flux/dev");
  });

  test("errors on an unknown model, mentioning list_models", async () => {
    const tool = generateImageTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat", model: "does-not-exist" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("list_models");
  });

  test("over threshold without confirm returns a non-error confirmation and does not submit", async () => {
    const tool = generateImageTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade({ confirmThreshold: 5 });
    const ctx = makeCtx({ generation: facade });

    // nano-banana: 3.98 * 3 = 11.94 -> ceil = 12, over the 5-credit threshold.
    const result = await tool.run({ prompt: "a cat", numImages: 3 }, ctx);

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Confirmation required");
    expect(textOf(result)).toContain("12 credits");
    expect(addPlaceholderCalls).toHaveLength(0);
    expect(startJobCalls).toHaveLength(0);
  });

  test("returns errorResult when startJob returns an error", async () => {
    const tool = generateImageTool();
    const { facade } = makeFacade({ startJob: async () => ({ error: "fal is down" }) });
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("fal is down");
  });

  // M14C follow-up: nano-banana's real fal endpoint has no image field (WebFetch-verified,
  // gen-catalog.ts) -> maxReferenceImages: 0 -> referenceMediaIds must reject cleanly, fast (no
  // entryUrl calls, no placeholder/job), instead of being silently ignored (the prior "DEFERRED" gap).
  describe("reference images (M14C follow-up)", () => {
    test("referenceMediaIds on the default (zero-cap) model: clean error, no entryUrl calls, no job started", async () => {
      const tool = generateImageTool();
      const calls: string[] = [];
      const entryUrl = async (ref: string) => { calls.push(ref); return `https://example.com/${ref}.png`; };
      const { facade, addPlaceholderCalls, startJobCalls } = makeFacade({ entryUrl });
      const ctx = makeCtx({ generation: facade });

      const result = await tool.run({ prompt: "a cat", referenceMediaIds: ["img-1"] }, ctx);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Nano Banana does not support reference images.");
      expect(calls).toHaveLength(0);
      expect(addPlaceholderCalls).toHaveLength(0);
      expect(startJobCalls).toHaveLength(0);
    });

    test("without referenceMediaIds, behaves exactly as before (no entryUrl calls)", async () => {
      const tool = generateImageTool();
      const calls: string[] = [];
      const entryUrl = async (ref: string) => { calls.push(ref); return `https://example.com/${ref}.png`; };
      const { facade, startJobCalls } = makeFacade({ entryUrl });
      const ctx = makeCtx({ generation: facade });

      const result = await tool.run({ prompt: "a cat" }, ctx);

      expect(result.isError).toBe(false);
      expect(calls).toHaveLength(0);
      expect(startJobCalls[0]!.input).not.toHaveProperty("image_url");
    });
  });
});

// ── generate_image dual-path ordering ───────────────────────────────────────

describe("generate_image tool — dual-path ordering", () => {
  test("falls back to the legacy sync path when ctx.generation is absent", async () => {
    const tool = generateImageTool();
    const ctx = makeCtx({ generateImage: async () => makeEntry() });

    const result = await tool.run({ prompt: "a cat" }, ctx);

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("img-1");
  });

  test("falls back to the legacy sync path when ctx.generation is present but hasKey() is false", async () => {
    const tool = generateImageTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade({ hasKey: async () => false });
    const ctx = makeCtx({ generation: facade, generateImage: async () => makeEntry() });

    const result = await tool.run({ prompt: "a cat" }, ctx);

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("img-1");
    expect(addPlaceholderCalls).toHaveLength(0);
    expect(startJobCalls).toHaveLength(0);
  });

  test("without a key and without ctx.generateImage, errors that image generation is not available", async () => {
    const tool = generateImageTool();
    const { facade } = makeFacade({ hasKey: async () => false });
    const ctx = makeCtx({ generation: facade }); // no generateImage

    const result = await tool.run({ prompt: "a cat" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not available");
  });
});
