import type { ZodType } from "zod";
import type { EditorStore, MediaManifest, MediaManifestEntry, TextStyle, TranscriptionResult } from "@palmier/core";
import type { ImageGenInput } from "../agent/image-generator.js";
import type { StartJobArgs } from "../generation/generation-service.js";

export type ToolBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; base64: string; mediaType: string };

export interface ToolResult {
  blocks: ToolBlock[];
  isError: boolean;
}

export interface ToolContext {
  store: EditorStore;
  getManifest: () => MediaManifest;
  newId: () => string;
  generateImage?: (input: ImageGenInput) => Promise<MediaManifestEntry>;
  renderFrame?: (atFrame: number) => Promise<{ rgba: Uint8Array; width: number; height: number; jpegBase64?: string }>;
  generation?: {
    hasKey(): Promise<boolean>;
    addPlaceholder(entry: MediaManifestEntry): void;
    startJob(args: StartJobArgs): Promise<{ jobId: string } | { error: string }>;
    // Resolves a library media ref to a URL fal can fetch (data URI or hosted). Optional in v1.
    entryUrl?(mediaRef: string): Promise<string | undefined>;
    confirmThreshold: number;
  };
  transcription?: {
    transcribe(mediaRef: string, opts?: { language?: string }): Promise<TranscriptionResult>;
    // Cache-only read: never transcribes.
    cachedTranscript(mediaRef: string): Promise<TranscriptionResult | null>;
    hasKey(): Promise<boolean>;
    estimateCredits(durationSeconds: number): number;
    // Rendered width of `text` at `style`'s font/size, as a FRACTION of the canvas width (see
    // buildCaptionPhrases' `measure`). Optional — M11D wires a real Canvas2D-backed impl from
    // @palmier/ui; until then, add_captions falls back to a character-count heuristic.
    measureText?(text: string, style: TextStyle): number;
  };
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodType;
  run(args: unknown, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
