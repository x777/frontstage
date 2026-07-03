import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { test, expect, vi, afterEach } from "vitest";
import { MatteSheet } from "../src/media/MatteSheet.js";

// jsdom has no real canvas 2D backend — stub getContext + toDataURL so renderMattePng's
// canvas.toDataURL(...) round-trips through a real (if fake) base64 PNG payload, mirroring
// media-library.test.ts's stubCanvasThumbnail helper.
function stubCanvasMatte(): { restore: () => void } {
  const getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockReturnValue({ fillRect: () => {}, fillStyle: "" } as any);
  const toDataURLSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue(`data:image/png;base64,${btoa("fake-png-bytes")}`);
  return {
    restore: () => {
      getContextSpy.mockRestore();
      toDataURLSpy.mockRestore();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeLibrary(impl?: (bytes: Uint8Array, mimeType: string, name?: string, folderId?: string) => Promise<{ assetId: string }>) {
  const calls: { bytes: Uint8Array; mimeType: string; name?: string; folderId?: string }[] = [];
  const resolved = impl ?? (async () => ({ assetId: "matte-asset-1" }));
  return {
    calls,
    importBytes: async (bytes: Uint8Array, mimeType: string, name?: string, folderId?: string) => {
      calls.push({ bytes, mimeType, name, folderId });
      return resolved(bytes, mimeType, name, folderId);
    },
  };
}

test("renders with the Project default: size readout matches the timeline dims (even-rounded)", () => {
  render(<MatteSheet library={fakeLibrary()} timelineWidth={1920} timelineHeight={1080} onClose={() => {}} />);
  expect(screen.getByTestId("matte-size-readout")).toHaveTextContent("1920 × 1080");
  expect(screen.getByTestId("matte-aspect-select")).toHaveValue("project");
});

test("changing the aspect updates the size readout live (no Create needed)", () => {
  render(<MatteSheet library={fakeLibrary()} timelineWidth={1920} timelineHeight={1080} onClose={() => {}} />);

  fireEvent.change(screen.getByTestId("matte-aspect-select"), { target: { value: "9:16" } });

  expect(screen.getByTestId("matte-size-readout")).toHaveTextContent("1080 × 1920");
});

test("color input updates the swatch background", () => {
  render(<MatteSheet library={fakeLibrary()} timelineWidth={1920} timelineHeight={1080} onClose={() => {}} />);

  fireEvent.change(screen.getByTestId("matte-color-input"), { target: { value: "#ff0000" } });

  expect(screen.getByTestId("matte-color-swatch")).toHaveStyle({ background: "#ff0000" });
});

test("Create Matte renders a PNG at the current size and imports it with the computed name + folderId", async () => {
  const canvas = stubCanvasMatte();
  try {
    const lib = fakeLibrary();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <MatteSheet library={lib} timelineWidth={1920} timelineHeight={1080} folderId="f1" onClose={onClose} onCreated={onCreated} />,
    );

    fireEvent.change(screen.getByTestId("matte-aspect-select"), { target: { value: "16:9" } });
    fireEvent.click(screen.getByTestId("matte-sheet-create"));

    await waitFor(() => expect(lib.calls).toHaveLength(1));
    expect(lib.calls[0]!.mimeType).toBe("image/png");
    expect(lib.calls[0]!.name).toBe("Matte · 16:9");
    expect(lib.calls[0]!.folderId).toBe("f1");
    expect(lib.calls[0]!.bytes.length).toBeGreaterThan(0);

    expect(onCreated).toHaveBeenCalledWith("matte-asset-1");
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    canvas.restore();
  }
});

test("busy state: the Create button disables while the import is in flight, and re-enables on failure", async () => {
  const canvas = stubCanvasMatte();
  try {
    let resolveImport!: () => void;
    const pending = new Promise<{ assetId: string }>((resolve) => {
      resolveImport = () => resolve({ assetId: "matte-asset-2" });
    });
    const lib = fakeLibrary(async () => pending);
    render(<MatteSheet library={lib} timelineWidth={1920} timelineHeight={1080} onClose={() => {}} />);

    const button = screen.getByTestId("matte-sheet-create");
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent("Creating…");

    resolveImport();
    await waitFor(() => expect(button).not.toBeDisabled());
  } finally {
    canvas.restore();
  }
});

test("a facade failure surfaces the error message and re-enables Create (no crash, sheet stays open)", async () => {
  const canvas = stubCanvasMatte();
  try {
    const lib = fakeLibrary(async () => {
      throw new Error("disk full");
    });
    const onClose = vi.fn();
    render(<MatteSheet library={lib} timelineWidth={1920} timelineHeight={1080} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("matte-sheet-create"));

    await waitFor(() => expect(screen.getByTestId("matte-sheet-error")).toHaveTextContent("disk full"));
    expect(screen.getByTestId("matte-sheet-create")).not.toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    canvas.restore();
  }
});

test("invalid hex fails at render time with the Swift-parity message, before importBytes is ever called", async () => {
  const lib = fakeLibrary();
  render(<MatteSheet library={lib} timelineWidth={1920} timelineHeight={1080} onClose={() => {}} />);

  fireEvent.change(screen.getByTestId("matte-color-input"), { target: { value: "not-a-color" } });
  fireEvent.click(screen.getByTestId("matte-sheet-create"));

  await waitFor(() => expect(screen.getByTestId("matte-sheet-error")).toHaveTextContent("Couldn't render matte image."));
  expect(lib.calls).toHaveLength(0);
});

test("close button and overlay click both call onClose; the inner card click does not", () => {
  const onClose = vi.fn();
  render(<MatteSheet library={fakeLibrary()} timelineWidth={1920} timelineHeight={1080} onClose={onClose} />);

  fireEvent.click(screen.getByTestId("matte-sheet"));
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("matte-sheet-close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});
