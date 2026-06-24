import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { GenerationPanel } from "../src/agent/GenerationPanel.js";
import type { MediaManifestEntry } from "@palmier/core";

function makeEntry(name: string): MediaManifestEntry {
  return {
    id: "x",
    name,
    type: "image",
    source: { kind: "project", relativePath: "media/x.png" },
    duration: 5,
    generationInput: { prompt: "a sunset", model: "m", duration: 5, aspectRatio: "1:1" },
  };
}

test("gen-submit disabled when prompt empty", () => {
  const fake = vi.fn().mockResolvedValue(makeEntry("a sunset.png"));
  render(<GenerationPanel generate={fake} />);
  expect(screen.getByTestId("gen-submit")).toBeDisabled();
});

test("gen-submit calls generate with prompt, clears prompt, shows success", async () => {
  const entry = makeEntry("a sunset.png");
  const fake = vi.fn().mockResolvedValue(entry);
  render(<GenerationPanel generate={fake} />);

  fireEvent.change(screen.getByTestId("gen-prompt"), { target: { value: "a sunset" } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("gen-submit"));
  });

  expect(fake).toHaveBeenCalledWith({ prompt: "a sunset" });

  const status = await screen.findByTestId("gen-status");
  expect(status.textContent).toContain("a sunset.png");

  expect((screen.getByTestId("gen-prompt") as HTMLTextAreaElement).value).toBe("");
});

test("generate rejection shows gen-error", async () => {
  const fake = vi.fn().mockRejectedValue(new Error("network error"));
  render(<GenerationPanel generate={fake} />);

  fireEvent.change(screen.getByTestId("gen-prompt"), { target: { value: "bad" } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("gen-submit"));
  });

  const err = await screen.findByTestId("gen-error");
  expect(err.textContent).toContain("network error");
});

test("model prop renders read-only model display", () => {
  const fake = vi.fn().mockResolvedValue(makeEntry("x.png"));
  render(<GenerationPanel generate={fake} model="m" />);
  expect(screen.getByTestId("gen-model").textContent).toContain("m");
});

test("onClose fires when close button clicked", () => {
  const fake = vi.fn().mockResolvedValue(makeEntry("x.png"));
  const onClose = vi.fn();
  render(<GenerationPanel generate={fake} onClose={onClose} />);
  fireEvent.click(screen.getByTestId("gen-close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("busy state shows Generating status while promise pending", async () => {
  let resolve!: (e: MediaManifestEntry) => void;
  const fake = vi.fn().mockReturnValue(
    new Promise<MediaManifestEntry>((res) => { resolve = res; }),
  );
  render(<GenerationPanel generate={fake} />);

  fireEvent.change(screen.getByTestId("gen-prompt"), { target: { value: "sky" } });
  // Start the click without awaiting — promise doesn't resolve yet
  act(() => { fireEvent.click(screen.getByTestId("gen-submit")); });

  await waitFor(() => expect(screen.getByTestId("gen-submit")).toBeDisabled());
  await waitFor(() => expect(screen.getByTestId("gen-status").textContent).toContain("Generating"));

  await act(async () => { resolve(makeEntry("sky.png")); });
  await waitFor(() => expect(screen.getByTestId("gen-status").textContent).toContain("sky.png"));
});
