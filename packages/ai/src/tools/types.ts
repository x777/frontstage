import type { ZodType } from "zod";
import type { EditorStore, MediaFolder, MediaManifest, MediaManifestEntry, TextStyle, TranscriptionResult } from "@palmier/core";
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
  // Media folder/entry CRUD facade backing the 7 folder tools (M12A T2) — mirrors the
  // MediaLibrary folder ops directly, so it stays in lockstep with getManifest().
  library?: {
    listFolders(): MediaFolder[];
    createFolder(name: string, parentFolderId?: string): MediaFolder;
    renameFolder(id: string, name: string): void;
    renameEntry(id: string, name: string): void;
    moveEntriesToFolder(assetIds: string[], folderId: string | undefined): void;
    deleteFolders(ids: string[]): { removedAssetIds: string[] };
    deleteEntries(ids: string[]): void;
  };
  // Placeholder-first import facade backing import_media (M12A T3). Each method registers a
  // placeholder synchronously and finalizes it asynchronously (probe → finalizeGenerated /
  // markGenerationFailed) — the tool returns as soon as the facade call resolves with the id(s).
  // mimeType is an extra (beyond the plan's literal signature) optional override for fromUrl so a
  // signed URL with no usable path extension can still be typed, mirroring the Swift override.
  mediaImport?: {
    fromBytes(bytes: Uint8Array, mimeType: string, name?: string, folderId?: string): Promise<{ assetId: string }>;
    fromUrl(url: string, name?: string, folderId?: string, mimeType?: string): Promise<{ assetId: string }>;
    // Desktop only — a directory recurses, mirroring its structure as folders.
    fromPath?(absPath: string, folderId?: string): Promise<{ assetIds: string[] }>;
  };
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodType;
  run(args: unknown, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
