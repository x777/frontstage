import { describe, expect, test } from "vitest";
import type { AiGateway, ImageResult, ImageRequest } from "../src/index.js";
import { ImageGenerator } from "../src/index.js";
import type { ImageImportHost } from "../src/index.js";
import type { MediaManifestEntry, GenerationLogEntry } from "@palmier/core";

function makeGateway(result: ImageResult): AiGateway {
  return {
    streamChat: async function* () {},
    generateImage: async () => result,
  } as unknown as AiGateway;
}

function makeCapturingGateway(result: ImageResult) {
  const capturedModels: string[] = [];
  const gateway: AiGateway = {
    streamChat: async function* () {},
    generateImage: async (req: ImageRequest) => {
      capturedModels.push(req.model);
      return result;
    },
  } as unknown as AiGateway;
  return { gateway, capturedModels };
}

function makeHost() {
  const calls: { entry: MediaManifestEntry; bytes: Uint8Array }[] = [];
  const log: GenerationLogEntry[] = [];
  const host: ImageImportHost = {
    addMedia(entry, bytes) { calls.push({ entry, bytes }); },
    appendGenerationLog(logEntry) { log.push(logEntry); },
  };
  return { host, calls, log };
}

describe("ImageGenerator.generate", () => {
  test("returns image entry with correct shape", async () => {
    // "QUJD" is base64 for "ABC"
    const gateway = makeGateway({ images: [{ base64: "QUJD", mediaType: "image/png" }] });
    const { host, calls } = makeHost();
    const gen = new ImageGenerator({ gateway, host, model: "m", newId: () => "id1", now: () => "2026-01-01T00:00:00Z" });

    const entry = await gen.generate({ prompt: "a cat" });

    expect(entry.id).toBe("id1");
    expect(entry.type).toBe("image");
    expect(entry.source.kind).toBe("project");
    expect((entry.source as { kind: "project"; relativePath: string }).relativePath).toBe("media/id1.png");
    expect(entry.duration).toBe(5);
    expect(entry.name).toContain("a cat");
    expect(entry.generationInput?.prompt).toBe("a cat");
    expect(entry.generationInput?.model).toBe("m");
  });

  test("host receives entry and decoded bytes", async () => {
    const gateway = makeGateway({ images: [{ base64: "QUJD", mediaType: "image/png" }] });
    const { host, calls } = makeHost();
    const gen = new ImageGenerator({ gateway, host, model: "m", newId: () => "id1", now: () => "2026-01-01T00:00:00Z" });

    await gen.generate({ prompt: "a cat" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.entry.id).toBe("id1");
    // "QUJD" decodes to bytes [65, 66, 67] = "ABC"
    expect(Array.from(calls[0]!.bytes)).toEqual([65, 66, 67]);
  });

  test("host receives generation log entry", async () => {
    const gateway = makeGateway({ images: [{ base64: "QUJD", mediaType: "image/png" }] });
    const { host, log } = makeHost();
    const gen = new ImageGenerator({ gateway, host, model: "m", newId: () => "id1", now: () => "2026-01-01T00:00:00Z" });

    await gen.generate({ prompt: "a cat" });

    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({ id: "id1", model: "m", costCredits: null, createdAt: "2026-01-01T00:00:00Z" });
  });

  test("jpeg mediaType produces .jpg extension", async () => {
    const gateway = makeGateway({ images: [{ base64: "QUJD", mediaType: "image/jpeg" }] });
    const { host, calls } = makeHost();
    const gen = new ImageGenerator({ gateway, host, model: "m", newId: () => "id2", now: () => "2026-01-01T00:00:00Z" });

    await gen.generate({ prompt: "sunset" });

    const relativePath = (calls[0]!.entry.source as { kind: "project"; relativePath: string }).relativePath;
    expect(relativePath).toBe("media/id2.jpg");
  });

  test("unknown mediaType falls back to .png", async () => {
    const gateway = makeGateway({ images: [{ base64: "QUJD", mediaType: "image/webp" }] });
    const { host, calls } = makeHost();
    const gen = new ImageGenerator({ gateway, host, model: "m", newId: () => "id3", now: () => "2026-01-01T00:00:00Z" });

    await gen.generate({ prompt: "art" });

    const relativePath = (calls[0]!.entry.source as { kind: "project"; relativePath: string }).relativePath;
    expect(relativePath).toBe("media/id3.png");
  });

  test("gateway returning no images throws", async () => {
    const gateway = makeGateway({ images: [] });
    const { host } = makeHost();
    const gen = new ImageGenerator({ gateway, host, model: "m", newId: () => "id1", now: () => "2026-01-01T00:00:00Z" });

    await expect(gen.generate({ prompt: "a cat" })).rejects.toThrow("no image returned");
  });

  test("setModel: next generate uses new model", async () => {
    const imageResult: ImageResult = { images: [{ base64: "QUJD", mediaType: "image/png" }] };
    const { gateway, capturedModels } = makeCapturingGateway(imageResult);
    const { host } = makeHost();
    const gen = new ImageGenerator({ gateway, host, model: "img1", newId: () => "id1", now: () => "2026-01-01T00:00:00Z" });

    await gen.generate({ prompt: "first" });
    expect(capturedModels[0]).toBe("img1");

    gen.setModel("img2");
    await gen.generate({ prompt: "second" });
    expect(capturedModels[1]).toBe("img2");
  });
});
