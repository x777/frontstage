import type { AiGateway } from "./wire.js";
import type { MediaManifestEntry, GenerationLogEntry } from "@palmier/core";

export interface ImageGenInput {
  prompt: string;
  referenceImages?: { base64: string; mediaType: string }[];
}

export interface ImageImportHost {
  addMedia(entry: MediaManifestEntry, bytes: Uint8Array): Promise<void> | void;
  appendGenerationLog?(logEntry: GenerationLogEntry): void;
}

export interface ImageGeneratorDeps {
  gateway: AiGateway;
  host: ImageImportHost;
  model: string;
  newId?: () => string;
  now?: () => string;
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function extFromMediaType(mediaType: string): string {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpg";
  return "png";
}

export class ImageGenerator {
  private readonly gateway: AiGateway;
  private readonly host: ImageImportHost;
  private readonly model: string;
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(deps: ImageGeneratorDeps) {
    this.gateway = deps.gateway;
    this.host = deps.host;
    this.model = deps.model;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async generate(input: ImageGenInput): Promise<MediaManifestEntry> {
    const result = await this.gateway.generateImage({
      model: this.model,
      prompt: input.prompt,
      referenceImages: input.referenceImages,
    });

    if (result.images.length === 0) throw new Error("no image returned");

    const image = result.images[0]!;
    const id = this.newId();
    const ext = extFromMediaType(image.mediaType);
    const relativePath = `media/${id}.${ext}`;
    const name = input.prompt.slice(0, 40) || "Generated image";

    const entry: MediaManifestEntry = {
      id,
      name,
      type: "image",
      source: { kind: "project", relativePath },
      duration: 5,
      generationInput: {
        prompt: input.prompt,
        model: this.model,
        duration: 5,
        aspectRatio: "1:1",
      },
    };

    const bytes = base64ToBytes(image.base64);
    await this.host.addMedia(entry, bytes);
    this.host.appendGenerationLog?.({ id, model: this.model, costCredits: null, createdAt: this.now() });

    return entry;
  }
}
