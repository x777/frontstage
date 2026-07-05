import { z } from "zod";
import {
  cuesFromCaptionClips,
  cuesFromTranscript,
  exportXmeml,
  exportFcpxml,
  formatSrt,
  formatVtt,
  timelineMediaRefs,
  timelineTotalFrames,
} from "@frontstage/core";
import type { SourceTimecode } from "@frontstage/core";
import type { ToolResult, ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

// Ported from Swift's export_project description (ToolDefinitions.swift) with the routing line
// verbatim; video/frontstage are narrowed to a deferral for this build (see the two error messages
// below) since neither has a headless path here yet. srt/vtt are a super-Swift addition (no Swift
// counterpart) — M14A T1.
const DESCRIPTION =
  "Exports the current project's timeline. mode defaults to video, but video export is not yet " +
  "available from the agent in this build — use the File menu's Export command instead. xml writes " +
  "XMEML timeline XML; fcpxml writes FCPXML. For timeline interchange, pick the format by the target " +
  "editor: Premiere Pro -> xml; DaVinci Resolve or Final Cut Pro -> fcpxml (fcpxml also carries text, " +
  "transforms, crop, opacity, and keyframes that xml cannot). fcpxmlTarget (fcpxml mode only, default " +
  "resolve) picks DaVinci Resolve vs. Final Cut Pro's crop/position value encoding. srt/vtt write a " +
  "subtitle file: by default from the timeline's caption clips (chronological, in this run — error if " +
  "there are none); pass captionsSource.mediaRef to export that media's CACHED transcript instead — " +
  "cache-only, this never transcribes, so an uncached ref errors naming get_transcript/add_captions. " +
  "frontstage (self-contained .frontstage project package) is not yet available either. Omit outputPath to " +
  "open a save dialog (desktop) or picker (web); xml, fcpxml, srt, and vtt finish and report their " +
  "result inline.";

const VIDEO_DEFERRED =
  "export_project: mode 'video' is not yet available from the agent in this build. Use the File menu's Export command.";
const FRONTSTAGE_DEFERRED =
  "export_project: mode 'frontstage' (self-contained .frontstage project export) is not yet available from the agent in this build. Use the File menu's Export command, or mode 'xml'/'fcpxml' for a timeline interchange export.";
const INTEROP_UNAVAILABLE = "export_project: timeline interchange export is not available in this context";
const NO_TRANSCRIPTION_FACADE = "export_project: transcript-backed subtitle export is not available in this context";
const NO_CAPTION_CLIPS =
  "export_project: the timeline has no caption clips to export — add captions first (add_captions), or pass captionsSource.mediaRef to export a cached transcript instead";

// z.string() + in-run validation, not z.enum: the enum-in-zod trap (M13A H2) — an enum in the schema
// rejects unknown values at the executor's safeParse gate, before run() ever sees them, so a custom
// error message here would be dead code.
const MODES = ["video", "xml", "fcpxml", "frontstage", "srt", "vtt"] as const;
type ExportMode = (typeof MODES)[number];
type FcpxmlTargetArg = "resolve" | "fcp";

interface ExportProjectArgs {
  mode?: string;
  outputPath?: string;
  overwrite?: boolean;
  fcpxmlTarget?: FcpxmlTargetArg;
  captionsSource?: { mediaRef?: string };
}

function isExportMode(mode: string): mode is ExportMode {
  return (MODES as readonly string[]).includes(mode);
}

function extensionForMode(mode: "xml" | "fcpxml"): string {
  return mode === "xml" ? "xml" : "fcpxml";
}

export function exportProjectTool(): ToolSpec {
  return {
    name: "export_project",
    description: DESCRIPTION,
    inputSchema: z.object({
      mode: z.string().optional(),
      outputPath: z.string().optional(),
      overwrite: z.boolean().optional(),
      fcpxmlTarget: z.enum(["resolve", "fcp"]).optional(),
      captionsSource: z.object({ mediaRef: z.string().optional() }).optional(),
    }),
    async run(args, ctx): Promise<ToolResult> {
      const { mode: modeArg = "video", outputPath, overwrite, fcpxmlTarget, captionsSource } = args as ExportProjectArgs;

      if (!isExportMode(modeArg)) {
        return errorResult(`export_project: unknown mode '${modeArg}'. Valid: ${MODES.join(", ")}`);
      }
      const mode = modeArg;

      if (mode === "video") return errorResult(VIDEO_DEFERRED);
      if (mode === "frontstage") return errorResult(FRONTSTAGE_DEFERRED);

      const facade = ctx.interopExport;
      if (!facade) return errorResult(INTEROP_UNAVAILABLE);

      const { timeline } = ctx.store.getSnapshot();
      const manifest = ctx.getManifest();
      const projectName = ctx.projectName?.() ?? "Project";

      if (mode === "srt" || mode === "vtt") {
        let cues;
        if (captionsSource?.mediaRef) {
          if (!ctx.transcription) return errorResult(NO_TRANSCRIPTION_FACADE);
          const transcript = await ctx.transcription.cachedTranscript(captionsSource.mediaRef);
          if (!transcript) {
            return errorResult(
              `export_project: no cached transcript for '${captionsSource.mediaRef}' — run get_transcript or add_captions on it first`,
            );
          }
          cues = cuesFromTranscript(transcript);
        } else {
          cues = cuesFromCaptionClips(timeline, timeline.fps);
          if (cues.length === 0) return errorResult(NO_CAPTION_CLIPS);
        }

        const contents = mode === "srt" ? formatSrt(cues) : formatVtt(cues);
        const defaultName = `${projectName}.${mode}`;

        let result: { path?: string; cancelled?: boolean };
        try {
          result = await facade.saveText(defaultName, contents, mode, outputPath, overwrite ?? true);
        } catch (err) {
          return errorResult(`export_project: ${toMessage(err)}`);
        }

        if (result.cancelled || !result.path) {
          return ok(JSON.stringify({ status: "cancelled", mode }));
        }
        return ok(JSON.stringify({ status: "exported", mode, path: result.path, cueCount: cues.length }, null, 2));
      }

      const mediaRefs = timelineMediaRefs(timeline);

      let startTimecodes: Map<string, SourceTimecode>;
      try {
        startTimecodes = await facade.readTimecodes(mediaRefs);
      } catch (err) {
        return errorResult(`export_project: ${toMessage(err)}`);
      }

      const projectRoot = facade.getProjectRoot?.();
      const xml =
        mode === "xml"
          ? exportXmeml(timeline, manifest.entries, { projectRoot, projectName, startTimecodes })
          : exportFcpxml(timeline, manifest.entries, { projectRoot, projectName, startTimecodes, target: fcpxmlTarget });

      const ext = extensionForMode(mode);
      const defaultName = `${projectName}.${ext}`;
      const kind = mode === "xml" ? "xmeml" : "fcpxml";

      let result: { path?: string; cancelled?: boolean };
      try {
        result = await facade.saveText(defaultName, xml, kind, outputPath, overwrite ?? true);
      } catch (err) {
        return errorResult(`export_project: ${toMessage(err)}`);
      }

      if (result.cancelled || !result.path) {
        return ok(JSON.stringify({ status: "cancelled", mode }));
      }

      const fps = timeline.fps;
      const durationFrames = timelineTotalFrames(timeline);
      return ok(
        JSON.stringify(
          {
            status: "exported",
            mode,
            path: result.path,
            width: timeline.width,
            height: timeline.height,
            durationFrames,
            durationSeconds: durationFrames / Math.max(1, fps),
            fps,
          },
          null,
          2,
        ),
      );
    },
  };
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
