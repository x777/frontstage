import { z } from "zod";
import { exportXmeml, exportFcpxml, timelineMediaRefs, timelineTotalFrames } from "@palmier/core";
import type { SourceTimecode } from "@palmier/core";
import type { ToolResult, ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

// Ported from Swift's export_project description (ToolDefinitions.swift) with the routing line
// verbatim; video/palmier are narrowed to a deferral for this build (see the two error messages
// below) since neither has a headless path here yet.
const DESCRIPTION =
  "Exports the current project's timeline. mode defaults to video, but video export is not yet " +
  "available from the agent in this build — use the File menu's Export command instead. xml writes " +
  "XMEML timeline XML; fcpxml writes FCPXML. For timeline interchange, pick the format by the target " +
  "editor: Premiere Pro -> xml; DaVinci Resolve or Final Cut Pro -> fcpxml (fcpxml also carries text, " +
  "transforms, crop, opacity, and keyframes that xml cannot). palmier (self-contained .palmier project " +
  "package) is not yet available either. Omit outputPath to open a save dialog (desktop) or picker " +
  "(web); xml and fcpxml finish and report their result inline.";

const VIDEO_DEFERRED =
  "export_project: mode 'video' is not yet available from the agent in this build. Use the File menu's Export command.";
const PALMIER_DEFERRED =
  "export_project: mode 'palmier' (self-contained .palmier project export) is not yet available from the agent in this build. Use the File menu's Export command, or mode 'xml'/'fcpxml' for a timeline interchange export.";
const INTEROP_UNAVAILABLE = "export_project: timeline interchange export is not available in this context";

type ExportMode = "video" | "xml" | "fcpxml" | "palmier";

interface ExportProjectArgs {
  mode?: ExportMode;
  outputPath?: string;
  overwrite?: boolean;
}

function extensionForMode(mode: "xml" | "fcpxml"): string {
  return mode === "xml" ? "xml" : "fcpxml";
}

export function exportProjectTool(): ToolSpec {
  return {
    name: "export_project",
    description: DESCRIPTION,
    inputSchema: z.object({
      mode: z.enum(["video", "xml", "fcpxml", "palmier"]).optional(),
      outputPath: z.string().optional(),
      overwrite: z.boolean().optional(),
    }),
    async run(args, ctx): Promise<ToolResult> {
      const { mode = "video", outputPath, overwrite } = args as ExportProjectArgs;

      if (mode === "video") return errorResult(VIDEO_DEFERRED);
      if (mode === "palmier") return errorResult(PALMIER_DEFERRED);

      const facade = ctx.interopExport;
      if (!facade) return errorResult(INTEROP_UNAVAILABLE);

      const { timeline } = ctx.store.getSnapshot();
      const manifest = ctx.getManifest();
      const projectName = ctx.projectName?.() ?? "Project";
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
          : exportFcpxml(timeline, manifest.entries, { projectRoot, projectName, startTimecodes });

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
