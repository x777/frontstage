import { describe, expect, test } from "vitest";
import { normalizeExportOutputPath } from "../src/renderer/desktop-interop-export.js";

// readTimecodes/saveText touch window.desktopMedia/window.desktopProject (Electron preload
// bridges, unavailable under vitest's node environment) — mirrors apps/web's convention of
// extracting and unit-testing only the pure logic (see web-audio-extract.test.ts).
describe("normalizeExportOutputPath", () => {
  test("appends the extension when outPath has none", () => {
    expect(normalizeExportOutputPath("/Users/alice/reel", "xmeml")).toBe("/Users/alice/reel.xml");
    expect(normalizeExportOutputPath("/Users/alice/reel", "fcpxml")).toBe("/Users/alice/reel.fcpxml");
  });

  test("REPLACES a mismatched extension rather than appending it", () => {
    expect(normalizeExportOutputPath("/Users/alice/reel.mp4", "xmeml")).toBe("/Users/alice/reel.xml");
    expect(normalizeExportOutputPath("/Users/alice/reel.mov", "fcpxml")).toBe("/Users/alice/reel.fcpxml");
  });

  test("leaves an already-correct extension unchanged", () => {
    expect(normalizeExportOutputPath("/Users/alice/reel.xml", "xmeml")).toBe("/Users/alice/reel.xml");
    expect(normalizeExportOutputPath("/Users/alice/reel.fcpxml", "fcpxml")).toBe("/Users/alice/reel.fcpxml");
  });

  test("extension match is case-insensitive", () => {
    expect(normalizeExportOutputPath("/Users/alice/reel.XML", "xmeml")).toBe("/Users/alice/reel.XML");
  });

  test("dots in directory names don't confuse the extension check", () => {
    expect(normalizeExportOutputPath("/Users/x.y/reel", "xmeml")).toBe("/Users/x.y/reel.xml");
    expect(normalizeExportOutputPath("/Users/x.y/reel.mp4", "xmeml")).toBe("/Users/x.y/reel.xml");
  });

  test("works with backslash-separated (Windows) paths", () => {
    expect(normalizeExportOutputPath("C:\\Users\\alice\\reel.mp4", "xmeml")).toBe("C:\\Users\\alice\\reel.xml");
    expect(normalizeExportOutputPath("C:\\Users\\alice\\reel", "xmeml")).toBe("C:\\Users\\alice\\reel.xml");
  });

  test("bare filename with no directory", () => {
    expect(normalizeExportOutputPath("reel.mp4", "xmeml")).toBe("reel.xml");
    expect(normalizeExportOutputPath("reel", "xmeml")).toBe("reel.xml");
  });

  test("srt/vtt (M14A T1): extension matches the kind name directly", () => {
    expect(normalizeExportOutputPath("/Users/alice/reel", "srt")).toBe("/Users/alice/reel.srt");
    expect(normalizeExportOutputPath("/Users/alice/reel.mp4", "vtt")).toBe("/Users/alice/reel.vtt");
    expect(normalizeExportOutputPath("/Users/alice/reel.srt", "srt")).toBe("/Users/alice/reel.srt");
  });
});
