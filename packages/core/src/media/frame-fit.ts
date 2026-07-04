/** Aspect-preserving size whose longest edge is at most `longestEdge` — never upscales. Ported
 * from Swift ToolExecutor+InspectTimeline.fit, shared by inspect_timeline's meta calc and the
 * host-side JPEG downscale so both agree on the rendered image's reported dimensions. */
export function fitLongestEdge(width: number, height: number, longestEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longestEdge) return { width, height };
  const scale = longestEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
