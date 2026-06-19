import type { Size } from "./mat2d.js";
import { defaultTransform, type Transform } from "./transform.js";

const ASPECT_TOLERANCE = 0.02;

/** Port of the macOS EditorViewModel.fitTransform (letterbox/pillarbox fit). */
export function fitTransform(source: Size, canvas: Size): Transform {
  if (source.width <= 0 || source.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return defaultTransform();
  }
  const canvasAspect = canvas.width / canvas.height;
  const sourceAspect = source.width / source.height;
  if (Math.abs(canvasAspect - sourceAspect) < ASPECT_TOLERANCE) {
    return defaultTransform();
  }
  if (sourceAspect > canvasAspect) {
    return { ...defaultTransform(), width: 1, height: canvasAspect / sourceAspect };
  }
  return { ...defaultTransform(), width: sourceAspect / canvasAspect, height: 1 };
}
