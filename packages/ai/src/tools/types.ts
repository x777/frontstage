import type { ZodType } from "zod";
import type { EditorStore, EmbeddingRow, MediaFolder, MediaManifest, MediaManifestEntry, SourceTimecode, TextStyle, TranscriptionResult } from "@palmier/core";
import type { ImageGenInput } from "../agent/image-generator.js";
import type { StartJobArgs } from "../generation/generation-service.js";
import type { EmbeddingModelInfo } from "../search/embedding-service.js";

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
  // opts requests a downscaled/re-encoded jpegBase64 (inspect_timeline); omitted, the call is
  // byte-for-byte inspect_color's original shape — no jpegBase64 key at all.
  renderFrame?: (
    atFrame: number,
    opts?: { maxEdge?: number; jpegQuality?: number },
  ) => Promise<{ rgba: Uint8Array; width: number; height: number; jpegBase64?: string }>;
  generation?: {
    hasKey(): Promise<boolean>;
    addPlaceholder(entry: MediaManifestEntry): void;
    startJob(args: StartJobArgs): Promise<{ jobId: string } | { error: string }>;
    // Resolves a library media ref to a URL fal can fetch (data URI or hosted). Optional in v1.
    entryUrl?(mediaRef: string): Promise<string | undefined>;
    confirmThreshold: number;
    // generate_audio's video-to-audio span source (M14C T3, the M10 deferral) — a headless,
    // silent (no audio), shortSide-downscaled render of [startFrame, startFrame+frameCount)
    // reusing the SAME export pipeline the real export gateways drive (@palmier/engine's
    // renderSpanToMp4). Absent -> the tool errors cleanly naming the capability.
    renderSpanToMp4?(startFrame: number, frameCount: number, shortSide: number): Promise<Uint8Array>;
    // Raw-bytes upload to the fal storage path (M11A's gateway.uploadFile) for renderSpanToMp4's
    // output — entryUrl only resolves EXISTING library entries, not ephemeral rendered bytes.
    uploadFile?(bytes: Uint8Array, contentType: string, fileName: string): Promise<string>;
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
    // The local whisper fallback's readiness (M14A T3) — LocalAsrService.state === "ready", synchronous
    // since it's a plain state read. Absent/omitted = treated as not-ready. Backs both the keyless
    // "Local — no credits used" estimate copy AND the explicit tools' keyless-local gate below.
    localReady?(): boolean;
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
    // Desktop only — a directory recurses, mirroring its structure as folders. name applies to
    // single-file paths only (Swift: displayName = name ?? filename); directories ignore it.
    fromPath?(absPath: string, folderId?: string, name?: string): Promise<{ assetIds: string[] }>;
    // Solid-color matte rendering (M13A T1, create_matte): the ai package can't touch canvas, so
    // hosts wire this from @palmier/ui's renderMattePng. Absent -> create_matte errors cleanly.
    renderMatte?(hex: string, width: number, height: number): Promise<Uint8Array>;
  };
  // .cube LUT project persistence (M14C T2, the Swift LUTLoader.store pattern) backing
  // apply_color's lut.path — mirrors the inspector's LUTSection picker so both paths store the
  // bytes the same way (luts/<name>, unique-suffix on collision) and reference the stored
  // project-relative path in the effect param.
  lut?: {
    // Always available once a project's open (rides the library's writeDerived/pending-persist
    // flow — cross-platform, no host-specific I/O). Returns the stored project-relative path.
    store(filename: string, bytes: Uint8Array): Promise<string>;
    // Desktop only (mirrors mediaImport.fromPath): reads bytes from an absolute local .cube path.
    readLocalFile?(absPath: string): Promise<Uint8Array>;
  };
  // Timeline interchange export facade (XMEML/FCPXML, + M14A T1's SRT/VTT) backing export_project —
  // the SAME object is also threaded into the UI's export command, so the agent tool and the File
  // menu share one save/timecode path per host.
  interopExport?: {
    // Desktop: reads embedded tmcd via ffprobe. Web: no filesystem access — resolves an empty map
    // (0-based export, the #247 regression-locked path).
    readTimecodes(mediaRefs: string[]): Promise<Map<string, SourceTimecode>>;
    // Desktop: the real absolute project directory, so exported media-rep/pathurl entries are real
    // file:// paths. Web: omitted — exporters fall back to the best-effort <projectName>-based path.
    getProjectRoot?(): string | undefined;
    // Desktop: outputPath given → writes directly there (overwrite=false + existing → throws);
    // outputPath omitted → a native save dialog picks the destination. Web: outputPath is ignored —
    // always a showSaveFilePicker-style picker (cancel → { cancelled: true }).
    saveText(
      defaultName: string,
      contents: string,
      kind: "fcpxml" | "xmeml" | "srt" | "vtt",
      outputPath?: string,
      overwrite?: boolean,
    ): Promise<{ path?: string; cancelled?: boolean }>;
  };
  // Project display name for exporters; falls back to "Project" when absent.
  projectName?: () => string;
  // SigLIP visual-search facade (M12C T2 shape; wired by T3/T4). Backs search_media's visual scope —
  // ready()/ensureReady() surface the download-gate state, cachedEmbeddings is a cache-only read
  // (never indexes) mirroring transcription's cachedTranscript.
  embedding?: {
    ready(): boolean;
    ensureReady(onProgress?: (p: { loaded: number; total: number }) => void): Promise<void>;
    embedText(q: string): Promise<Float32Array>;
    cachedEmbeddings(mediaRef: string): Promise<EmbeddingRow[] | null>;
    modelInfo: EmbeddingModelInfo;
  };
  // Project navigation facade (M13B T1, get_projects/open_project/new_project) — desktop only,
  // wired over IPC to the main-process recent-projects registry. Absent on web and in the in-app
  // agent's context (those tools are MCP-catalog-only regardless). Single-window/in-place model:
  // there is at most one open project, so isOpen === isActive everywhere in list().
  projects?: {
    list(): Promise<{
      projects: Array<{ id: string; name: string; path: string; isOpen: boolean; isActive: boolean; isAccessible: boolean }>;
      active?: { name: string; path: string };
    }>;
    // path is tilde-expanded upstream (by the tool); auto-save-first happens inside.
    openByPath(path: string): Promise<void>;
    openById(id: string): Promise<void>;
    create(name: string): Promise<{ path: string }>;
    activePath(): string | undefined;
  };
  // Skills facade (M15 T1, read_skill) — backs the tool's body lookup only; the SkillStore itself
  // lives above the tool layer (hosts wire ctx.skills = { body: (id) => store.body(id) }). In-app
  // agent context ONLY — absent on the MCP path (read_skill isn't in that catalog anyway; T2 keeps
  // both guards).
  skills?: {
    body(id: string): string | undefined;
  };
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodType;
  run(args: unknown, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
