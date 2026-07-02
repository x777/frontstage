import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline } from "@palmier/core";
import type { MediaManifest, MediaManifestEntry } from "@palmier/core";
import { generateVideoTool, upscaleMediaTool } from "../src/tools/generate-tools.js";
import type { ToolContext } from "../src/index.js";
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
    newId: () => "new-id",
    ...overrides,
  };
}

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  const block = result.blocks[0];
  return block?.kind === "text" ? (block.text ?? "") : "";
}

// ── generate_video ──────────────────────────────────────────────────────────

describe("generate_video tool", () => {
  test("has the correct name", () => {
    expect(generateVideoTool().name).toBe("generate_video");
  });

  test("errors when ctx.generation is absent", async () => {
    const tool = generateVideoTool();
    const ctx = makeCtx();

    const result = await tool.run({ prompt: "a cat", model: "veo3.1-fast" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not available");
  });

  test("errors when no fal key is configured, pointing at settings", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade({ hasKey: async () => false });
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat", model: "veo3.1-fast" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Settings");
  });

  test("errors on an unknown model, mentioning list_models", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat", model: "does-not-exist" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("list_models");
  });

  test("errors when the model is not a video-kind model", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run({ prompt: "a cat", model: "nano-banana" }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("list_models");
  });

  test("errors on an invalid duration, naming the allowed values", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 999, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Veo 3.1 Fast does not support duration '999s'. Valid: 4s, 6s, 8s.");
  });

  test("over threshold without confirm returns a non-error confirmation and does not submit", async () => {
    const tool = generateVideoTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade });

    // veo3.1-fast @ 1080p * 8s = 15 * 8 = 120 credits, over the 50-credit threshold.
    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 8, resolution: "1080p" },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Confirmation required");
    expect(textOf(result)).toContain("120 credits");
    expect(textOf(result)).toContain("confirm: true");
    expect(addPlaceholderCalls).toHaveLength(0);
    expect(startJobCalls).toHaveLength(0);
  });

  test("with confirm: true, adds a placeholder and starts the job with the endpoint + built input + cost", async () => {
    const tool = generateVideoTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "vid-1" });

    const result = await tool.run(
      { prompt: "a cat on a skateboard", model: "veo3.1-fast", duration: 8, resolution: "1080p", aspectRatio: "16:9", confirm: true },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(addPlaceholderCalls).toHaveLength(1);
    const placeholder = addPlaceholderCalls[0]!;
    expect(placeholder.id).toBe("vid-1");
    expect(placeholder.type).toBe("video");
    expect(placeholder.generationInput?.model).toBe("fal-ai/veo3.1/fast");
    expect(placeholder.generationInput?.prompt).toBe("a cat on a skateboard");

    expect(startJobCalls).toHaveLength(1);
    const call = startJobCalls[0]!;
    expect(call.modelEndpoint).toBe("fal-ai/veo3.1/fast");
    expect(call.model).toBe("fal-ai/veo3.1/fast");
    expect(call.costCredits).toBe(120);
    expect(call.input).toEqual({
      prompt: "a cat on a skateboard",
      duration: "8s",
      aspect_ratio: "16:9",
      resolution: "1080p",
      generate_audio: true,
    });
    expect(call.placeholders).toEqual([placeholder]);
  });

  test("returns errorResult when startJob returns an error", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade({ startJob: async () => ({ error: "fal is down" }) });
    const ctx = makeCtx({ generation: facade });

    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 4, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("fal is down");
  });

  test("success names the placeholder asset id", async () => {
    const tool = generateVideoTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade, newId: () => "vid-42" });

    const result = await tool.run(
      { prompt: "a cat", model: "veo3.1-fast", duration: 4, confirm: true },
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("vid-42");
  });
});

// ── upscale_media ────────────────────────────────────────────────────────────

function makeVideoManifest(): MediaManifest {
  return {
    version: 2,
    folders: [],
    entries: [
      {
        id: "src-video",
        name: "clip.mp4",
        type: "video",
        source: { kind: "project", relativePath: "media/src-video.mp4" },
        duration: 10,
      },
      {
        id: "src-image",
        name: "still.png",
        type: "image",
        source: { kind: "project", relativePath: "media/src-image.png" },
        duration: 5,
      },
    ],
  };
}

describe("upscale_media tool", () => {
  test("has the correct name", () => {
    expect(upscaleMediaTool().name).toBe("upscale_media");
  });

  test("errors when the requested model does not support the source's type", async () => {
    const tool = upscaleMediaTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest() });

    // seedvr-upscale only supports "video"; src-image is an image.
    const result = await tool.run({ mediaRef: "src-image", model: "seedvr-upscale", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not support");
  });

  test("errors honestly when the facade cannot resolve a media URL", async () => {
    const tool = upscaleMediaTool();
    const { facade } = makeFacade({ entryUrl: undefined });
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest() });

    const result = await tool.run({ mediaRef: "src-video", confirm: true }, ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("media upload not available yet");
  });

  test("with confirm and a resolvable URL, starts the job with sourceUrl in the built input", async () => {
    const tool = upscaleMediaTool();
    const { facade, addPlaceholderCalls, startJobCalls } = makeFacade({
      entryUrl: async (ref) => `https://example.com/${ref}.mp4`,
    });
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest(), newId: () => "up-1" });

    const result = await tool.run({ mediaRef: "src-video", confirm: true }, ctx);

    expect(result.isError).toBe(false);
    expect(addPlaceholderCalls).toHaveLength(1);
    expect(startJobCalls).toHaveLength(1);
    const call = startJobCalls[0]!;
    expect(call.modelEndpoint).toBe("fal-ai/seedvr/upscale/video");
    expect(call.input).toMatchObject({ video_url: "https://example.com/src-video.mp4" });
    expect(textOf(result)).toContain("up-1");
  });

  test("errors when the source media is not found", async () => {
    const tool = upscaleMediaTool();
    const { facade } = makeFacade();
    const ctx = makeCtx({ generation: facade, getManifest: () => makeVideoManifest() });

    const result = await tool.run({ mediaRef: "does-not-exist", confirm: true }, ctx);

    expect(result.isError).toBe(true);
  });
});
