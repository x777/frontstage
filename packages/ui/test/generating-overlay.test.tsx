import { render, screen } from "@testing-library/react";
import type { GenerationStatus } from "@frontstage/core";
import { GeneratingOverlay, generatingLabel } from "../src/media/GeneratingOverlay.js";

test("generatingLabel maps each status kind", () => {
  expect(generatingLabel({ kind: "preparing" })).toBe("Preparing...");
  expect(generatingLabel({ kind: "downloading" })).toBe("Downloading...");
  expect(generatingLabel({ kind: "rendering" })).toBe("Rendering...");
  expect(generatingLabel({ kind: "generating" })).toBe("Generating...");
  expect(generatingLabel({ kind: "transcribing" })).toBe("Transcribing...");
  expect(generatingLabel({ kind: "failed", message: "boom" } satisfies GenerationStatus)).toBe("Generating...");
});

test("renders the given label", () => {
  render(<GeneratingOverlay label="Rendering..." />);
  expect(screen.getByTestId("generating-overlay")).toHaveTextContent("Rendering...");
});
