import type { CubeLUT, Timeline } from "@palmier/core";
import { parseCubeLUT } from "@palmier/core";

const LUT_TYPE = "color.lut";

/**
 * The M9D deferral, closed (M14C T2): a color.lut effect's path survives a project reload, but the
 * per-path GPU texture cache (webgpu-renderer.ts's registerLUT) is fresh per engine instance — the
 * LUT silently didn't render until the user re-picked the file in LUTSection. This scans a
 * timeline for project-relative lut paths (luts/<name> — anything the picker/apply_color stored)
 * and re-registers each one at most once: bytes (via readDerived) -> parseCubeLUT -> registerLUT.
 *
 * A bare filename (pre-M14C picks, or no project open) isn't project-relative and can't be loaded
 * from here — skipped, same as today (still needs a re-pick).
 */
export class LutReconciler {
  private known = new Set<string>();

  reconcile(
    timeline: Timeline,
    readDerived: (relativePath: string) => Promise<Uint8Array | null>,
    registerLUT: ((path: string, cube: CubeLUT) => void) | undefined,
  ): void {
    if (!registerLUT) return; // engine not ready yet — retry on the next call
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        for (const eff of clip.effects ?? []) {
          if (eff.type !== LUT_TYPE) continue;
          const path = eff.params["path"]?.string;
          if (!path || !path.startsWith("luts/") || this.known.has(path)) continue;
          this.known.add(path);
          void this.load(path, readDerived, registerLUT);
        }
      }
    }
  }

  private async load(
    path: string,
    readDerived: (relativePath: string) => Promise<Uint8Array | null>,
    registerLUT: (path: string, cube: CubeLUT) => void,
  ): Promise<void> {
    const bytes = await readDerived(path);
    if (!bytes) return;
    const cube = parseCubeLUT(new TextDecoder().decode(bytes));
    if (!cube) return;
    registerLUT(path, cube);
  }
}
