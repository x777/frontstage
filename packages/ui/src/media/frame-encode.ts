import { fitLongestEdge } from "@palmier/core";

// Canvas-backed RGBA -> JPEG encode for renderFrame's optional opts (inspect_timeline). Thin host
// glue, verified interactively like renderMattePng — jsdom has no canvas 2D context to unit test.
const ENCODE_FAILED = "Couldn't encode frame image.";

export async function encodeFrameJPEG(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts?: { maxEdge?: number; jpegQuality?: number },
): Promise<string> {
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) throw new Error(ENCODE_FAILED);
  // Copies (rather than a zero-copy view over rgba.buffer) so this compiles under both ArrayBuffer
  // and SharedArrayBuffer backings of Uint8Array — ImageData requires a plain ArrayBuffer.
  const clamped = new Uint8ClampedArray(rgba);
  sourceCtx.putImageData(new ImageData(clamped, width, height), 0, 0);

  const target = opts?.maxEdge ? fitLongestEdge(width, height, opts.maxEdge) : { width, height };
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(ENCODE_FAILED);
  ctx.drawImage(source, 0, 0, target.width, target.height);

  const dataUrl = canvas.toDataURL("image/jpeg", opts?.jpegQuality);
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error(ENCODE_FAILED);
  return dataUrl.slice(comma + 1);
}
