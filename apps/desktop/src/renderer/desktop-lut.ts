import type { MediaLibrary } from "@frontstage/ui";
import type { ToolContext } from "@frontstage/ai";
import "./desktop-audio-extract.js"; // declares window.desktopMedia (incl. readLocalFile)

// .cube LUT project persistence (M14C T2, the Swift LUTLoader.store pattern) — apply_color's
// facade half; the store() side is cross-platform (rides library.storeLut's writeDerived flow),
// readLocalFile is desktop-only since it reads an arbitrary absolute path off disk.
export function createDesktopLut(library: MediaLibrary): NonNullable<ToolContext["lut"]> {
  return {
    store: (filename, bytes) => library.storeLut(filename, bytes),
    readLocalFile: async (absPath: string) => {
      const result = await window.desktopMedia.readLocalFile(absPath);
      if ("error" in result) throw new Error(result.error);
      return new Uint8Array(result.bytes);
    },
  };
}
