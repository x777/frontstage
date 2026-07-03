import { describe, expect, test } from "vitest";
import {
  MODEL_CATALOG,
  listLLMModels,
  listImageModels,
  defaultLLMModel,
  defaultImageModel,
} from "../src/agent/model-catalog.js";

describe("model-catalog", () => {
  test("listLLMModels returns only kind:llm entries", () => {
    const llms = listLLMModels();
    expect(llms.length).toBeGreaterThan(0);
    expect(llms.every((e) => e.kind === "llm")).toBe(true);
  });

  test("listImageModels returns only kind:image entries", () => {
    const imgs = listImageModels();
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs.every((e) => e.kind === "image")).toBe(true);
  });

  test("listLLMModels + listImageModels together cover all MODEL_CATALOG entries", () => {
    const all = [...listLLMModels(), ...listImageModels()];
    expect(all).toHaveLength(MODEL_CATALOG.length);
  });

  test("defaultLLMModel returns the isDefault llm id", () => {
    expect(defaultLLMModel()).toBe("anthropic/claude-sonnet-5");
  });

  test("defaultImageModel returns the isDefault image id", () => {
    expect(defaultImageModel()).toBe("google/gemini-2.5-flash-image-preview");
  });

  test("every entry has a non-empty id and label", () => {
    for (const entry of MODEL_CATALOG) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});
