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
 *
 * A permanently-missing/unparseable file (M14C final-review Medium #3) attempts exactly once
 * (`known` gates re-attempts), logs one console.warn, and records it in `failed` so LUTSection can
 * show "file missing" instead of silently pretending the LUT is loaded.
 */
export class LutReconciler {
  private known = new Set<string>();
  // Paths attempted-and-failed (missing bytes or unparseable) — one warn ever per path, and the
  // inspector's LUTSection can query isFailed() to show "file missing" instead of pretending loaded.
  private failed = new Set<string>();
  private listeners = new Set<() => void>();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** True once a load attempt for this project-relative path has failed (missing file or bad .cube). */
  isFailed(path: string): boolean {
    return this.failed.has(path);
  }

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
    if (!bytes) {
      this.markFailed(path, "file missing");
      return;
    }
    const cube = parseCubeLUT(new TextDecoder().decode(bytes));
    if (!cube) {
      this.markFailed(path, "invalid .cube content");
      return;
    }
    registerLUT(path, cube);
    this.notify();
  }

  private markFailed(path: string, reason: string): void {
    console.warn(`[LutReconciler] "${path}" could not be loaded (${reason}) — not retrying`);
    this.failed.add(path);
    this.notify();
  }
}
