import { z } from "zod";
import { fitLongestEdge, timelineTotalFrames } from "@palmier/core";
import type { ToolBlock, ToolSpec } from "./types.js";
import { errorResult } from "./executor.js";

const DEFAULT_MAX_FRAMES = 6;
const MAX_FRAMES_CAP = 12;
const RENDER_MAX_EDGE = 512;
const RENDER_JPEG_QUALITY = 0.7;

export function inspectTimelineTool(): ToolSpec {
  return {
    name: "inspect_timeline",
    description:
      "See the composited timeline — what the user actually sees in the preview at a given frame: all video tracks " +
      "stacked with their transforms, opacity, crop, and keyframes applied, plus text and caption overlays baked in. " +
      "Use this to verify your edits landed (a PIP's position, a title's placement, layer order) — inspect_media shows " +
      "the raw source asset, not the cut.\n\n" +
      "Frames are project frames (from get_timeline). Pass a single startFrame for one composited frame; add endFrame " +
      "to sample maxFrames evenly across [startFrame, endFrame) for a transition or sequence. Frames past content " +
      "render black. Returns frames downscaled for token efficiency, with the frameNumbers sampled.\n\n" +
      "Rendering seeks the preview to render each frame — the visible playhead may move as a result (same caveat as " +
      "inspect_color).",
    inputSchema: z.object({
      startFrame: z.number().int().optional(),
      endFrame: z.number().int().optional(),
      maxFrames: z.number().int().optional(),
    }),
    async run(args, ctx) {
      if (!ctx.renderFrame) return errorResult("frame rendering is not available in this context");
      const a = args as { startFrame?: number; endFrame?: number; maxFrames?: number };

      const tl = ctx.store.getSnapshot().timeline;
      const totalFrames = timelineTotalFrames(tl);
      if (totalFrames <= 0) return errorResult("Timeline is empty — nothing to render.");

      const startFrame = a.startFrame ?? 0;
      if (startFrame < 0 || startFrame >= totalFrames) {
        return errorResult(`startFrame ${startFrame} out of range [0, ${totalFrames}).`);
      }

      let sampledFrames: number[];
      if (a.endFrame !== undefined) {
        const endFrame = Math.min(a.endFrame, totalFrames);
        if (endFrame <= startFrame) {
          return errorResult(`endFrame must be greater than startFrame (${startFrame}).`);
        }
        const span = endFrame - startFrame;
        const count = Math.max(1, Math.min(a.maxFrames ?? DEFAULT_MAX_FRAMES, MAX_FRAMES_CAP, span));
        sampledFrames = Array.from({ length: count }, (_, i) => startFrame + Math.floor((span * (i + 0.5)) / count));
      } else {
        sampledFrames = [startFrame];
      }

      const renderSize = fitLongestEdge(tl.width, tl.height, RENDER_MAX_EDGE);
      const blocks: ToolBlock[] = [];
      const renderedFrames: number[] = [];
      for (const frame of sampledFrames) {
        let rendered;
        try {
          rendered = await ctx.renderFrame(frame, { maxEdge: RENDER_MAX_EDGE, jpegQuality: RENDER_JPEG_QUALITY });
        } catch {
          continue;
        }
        if (!rendered.jpegBase64) continue;
        blocks.push({ kind: "image", base64: rendered.jpegBase64, mediaType: "image/jpeg" });
        renderedFrames.push(frame);
      }
      if (blocks.length === 0) return errorResult("Failed to render timeline frames.");

      blocks.push({
        kind: "text",
        text: JSON.stringify({
          fps: tl.fps,
          width: renderSize.width,
          height: renderSize.height,
          totalFrames,
          frameNumbers: renderedFrames,
        }),
      });
      return { blocks, isError: false };
    },
  };
}
