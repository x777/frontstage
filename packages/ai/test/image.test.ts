import { describe, expect, test } from "vitest";
import { buildImageBody, parseImageResponse } from "../src/agent/image.js";

describe("buildImageBody", () => {
  test("no referenceImages", () => {
    const body = buildImageBody({ model: "m", prompt: "a cat" }) as Record<string, unknown>;
    expect(body.model).toBe("m");
    expect(body.stream).toBe(false);
    expect(body.modalities).toEqual(["image", "text"]);
    const msgs = body.messages as { role: string; content: unknown[] }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.content).toEqual([{ type: "text", text: "a cat" }]);
  });

  test("with referenceImages", () => {
    const body = buildImageBody({
      model: "m",
      prompt: "a cat",
      referenceImages: [{ base64: "AAA", mediaType: "image/png" }],
    }) as Record<string, unknown>;
    expect(body.stream).toBe(false);
    expect(body.modalities).toEqual(["image", "text"]);
    const content = (body.messages as { role: string; content: unknown[] }[])[0]!.content;
    expect(content[0]).toEqual({ type: "text", text: "a cat" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA" },
    });
  });
});

describe("parseImageResponse", () => {
  test("valid image response", () => {
    const json = {
      choices: [
        {
          message: {
            images: [
              { type: "image_url", image_url: { url: "data:image/png;base64,XYZ" } },
            ],
          },
        },
      ],
    };
    const result = parseImageResponse(json);
    expect(result).toEqual({ images: [{ base64: "XYZ", mediaType: "image/png" }] });
  });

  test("no images field → empty", () => {
    const result = parseImageResponse({ choices: [{ message: {} }] });
    expect(result).toEqual({ images: [] });
  });

  test("empty images array", () => {
    const result = parseImageResponse({ choices: [{ message: { images: [] } }] });
    expect(result).toEqual({ images: [] });
  });

  test("null input → empty, no throw", () => {
    expect(parseImageResponse(null)).toEqual({ images: [] });
  });

  test("wrong shape → empty, no throw", () => {
    expect(parseImageResponse({ choices: [] })).toEqual({ images: [] });
    expect(parseImageResponse("bad")).toEqual({ images: [] });
  });

  test("image with bad url → skipped", () => {
    const json = {
      choices: [
        {
          message: {
            images: [
              { type: "image_url", image_url: { url: "not-a-data-url" } },
              { type: "image_url", image_url: { url: "data:image/jpeg;base64,ABC" } },
            ],
          },
        },
      ],
    };
    const result = parseImageResponse(json);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toEqual({ base64: "ABC", mediaType: "image/jpeg" });
  });
});
