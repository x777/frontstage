// OpenRouter model ids — verify/update against OpenRouter; data-driven, edit here to add models.
export interface ModelEntry { id: string; label: string; kind: "llm" | "image"; isDefault?: boolean; }

export const MODEL_CATALOG: ModelEntry[] = [
  { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8", kind: "llm" },
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", kind: "llm", isDefault: true },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", kind: "llm" },
  { id: "google/gemini-2.5-flash-image-preview", label: "Gemini Flash Image", kind: "image", isDefault: true },
];

export function listLLMModels(): ModelEntry[] {
  return MODEL_CATALOG.filter((e) => e.kind === "llm");
}

export function listImageModels(): ModelEntry[] {
  return MODEL_CATALOG.filter((e) => e.kind === "image");
}

export function defaultLLMModel(): string {
  const llms = listLLMModels();
  return (llms.find((e) => e.isDefault) ?? llms[0]!).id;
}

export function defaultImageModel(): string {
  const imgs = listImageModels();
  return (imgs.find((e) => e.isDefault) ?? imgs[0]!).id;
}
