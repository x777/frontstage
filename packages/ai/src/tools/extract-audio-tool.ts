import { z } from "zod";
import { canExtractAudioFromEntry, extractedAudioName } from "@frontstage/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

export function extractAudioTool(): ToolSpec {
  return {
    name: "extract_audio",
    description:
      "Extracts the soundtrack from a video library asset into a new audio asset in the same folder, " +
      "named '{source} (audio)'. The source video is unchanged. Requires a host that can demux audio " +
      "(desktop ffmpeg). One library mutation; not an undoable timeline edit.",
    inputSchema: z.object({
      mediaRef: z.string().min(1),
    }),
    async run(args, ctx) {
      const { mediaRef } = args as { mediaRef: string };
      const entry = ctx.getManifest().entries.find((e) => e.id === mediaRef);
      if (!entry) return errorResult(`extract_audio: media asset not found: ${mediaRef}`);
      if (!canExtractAudioFromEntry(entry)) {
        return errorResult(
          `extract_audio: '${mediaRef}' is not an extractable video (need a video with audio, not generating).`,
        );
      }
      const extract = ctx.extractAudio;
      if (!extract) {
        return errorResult("extract_audio: audio extraction is not available in this context (desktop ffmpeg).");
      }
      const importer = ctx.mediaImport;
      if (!importer) return errorResult("extract_audio: media import is not available in this context");

      let extracted: { bytes: Uint8Array; durationSeconds: number };
      try {
        extracted = await extract.extract(mediaRef);
      } catch (err) {
        return errorResult(`extract_audio: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!extracted.bytes.length || !(extracted.durationSeconds > 0)) {
        return errorResult("extract_audio: extracted soundtrack was empty.");
      }

      try {
        const { assetId } = await importer.fromBytes(
          extracted.bytes,
          "audio/wav",
          extractedAudioName(entry.name),
          entry.folderId,
        );
        return ok(
          JSON.stringify({
            mediaRef: assetId,
            type: "audio",
            durationSeconds: extracted.durationSeconds,
            sourceMediaRef: mediaRef,
          }),
        );
      } catch (err) {
        return errorResult(`extract_audio: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
