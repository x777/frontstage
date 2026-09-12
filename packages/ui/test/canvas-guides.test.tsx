import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { emptyCanvasOverlaySelection } from "@frontstage/core";
import type { CanvasOverlaySelection } from "@frontstage/core";
import { CanvasGuidesMenu } from "../src/preview/CanvasGuidesMenu.js";
import { CanvasViewingOverlay } from "../src/preview/CanvasViewingOverlay.js";

function Harness() {
  const [selection, setSelection] = useState<CanvasOverlaySelection>(() => emptyCanvasOverlaySelection());
  return (
    <>
      <CanvasGuidesMenu selection={selection} onChange={setSelection} />
      <CanvasViewingOverlay
        selection={selection}
        canvasRect={{ left: 0, top: 0, width: 1920, height: 1080 }}
      />
    </>
  );
}

test("canvas guides menu toggles action-safe overlay and hide clears it", () => {
  render(<Harness />);
  expect(screen.queryByTestId("canvas-viewing-overlay")).toBeNull();
  act(() => { fireEvent.click(screen.getByTestId("canvas-guides-button")); });
  act(() => { fireEvent.click(screen.getByTestId("canvas-guides-menu-list-guide-actionSafe")); });
  expect(screen.getByTestId("canvas-viewing-overlay")).toBeInTheDocument();
  act(() => { fireEvent.click(screen.getByTestId("canvas-guides-menu-list-hide")); });
  expect(screen.queryByTestId("canvas-viewing-overlay")).toBeNull();
});
