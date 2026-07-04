/** Aspect-preserving size whose longest edge is at most `longestEdge` — never upscales. Ported
 * from Swift ToolExecutor+InspectTimeline.fit, shared by inspect_timeline's meta calc and the
 * host-side JPEG downscale so both agree on the rendered image's reported dimensions. */
export function fitLongestEdge(width: number, height: number, longestEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longestEdge) return { width, height };
  const scale = longestEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Aspect-preserving size whose SHORTEST edge is at most `shortSide` — never upscales, and rounds
 * each dimension to an even number (min 2). Ported from Swift TimelineRenderer.renderSize, used by
 * generate_audio's span-render (M14C T3) to shrink the uploaded scoring video. */
export function fitShortestSide(width: number, height: number, shortSide: number): { width: number; height: number } {
  const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2);
  if (width <= 0 || height <= 0) return { width: even(width), height: even(height) };
  const shortest = Math.min(width, height);
  const scale = Math.min(1, shortSide / shortest);
  return { width: even(width * scale), height: even(height * scale) };
}
