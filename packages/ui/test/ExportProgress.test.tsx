import { render, screen } from "@testing-library/react";
import { ExportProgress } from "../src/editor/ExportProgress.js";

test("renders nothing when state is null", () => {
  render(<ExportProgress state={null} />);
  expect(screen.queryByTestId("export-progress")).toBeNull();
});

test("renders label and progress when state provided", () => {
  render(<ExportProgress state={{ label: "out.mp4", done: 2, total: 3 }} />);
  expect(screen.getByTestId("export-progress")).toBeInTheDocument();
  expect(screen.getByTestId("export-progress-label").textContent).toBe("out.mp4");
  expect(screen.getByTestId("export-progress").textContent).toContain("2/3");
});

test("percent bar width reflects progress", () => {
  render(<ExportProgress state={{ label: "out.mp4", done: 2, total: 3 }} />);
  const bar = screen.getByTestId("export-progress-bar");
  // 2/3 ≈ 67%
  expect(bar.style.width).toBe("67%");
});
