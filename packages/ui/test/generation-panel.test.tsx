import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { GenerationPanel } from "../src/agent/GenerationPanel.js";
import type { MediaManifestEntry } from "@frontstage/core";

function makeFacade(opts: { hasKey?: boolean; startJobResult?: { jobId: string } | { error: string }; entryUrl?: (id: string) => Promise<string | undefined> } = {}) {
  return {
    hasKey: vi.fn().mockResolvedValue(opts.hasKey ?? true),
    addPlaceholder: vi.fn(),
    startJob: vi.fn().mockResolvedValue(opts.startJobResult ?? { jobId: "job-1" }),
    confirmThreshold: 50,
    entryUrl: opts.entryUrl ? vi.fn(opts.entryUrl) : vi.fn(async (id: string) => `https://example.com/${id}.png`),
  };
}

function makeNewId() {
  let n = 0;
  return () => `id-${n++}`;
}

function imageEntry(id: string, name = `${id}.png`): MediaManifestEntry {
  return { id, name, type: "image", source: { kind: "project", relativePath: `media/${id}.png` }, duration: 1 };
}

test("tab switch swaps the model options by kind", async () => {
  render(<GenerationPanel generation={makeFacade()} newId={makeNewId()} />);

  const initialOptions = Array.from((screen.getByTestId("gen-model-select") as HTMLSelectElement).options).map((o) => o.textContent);
  expect(initialOptions).toContain("Veo 3.1 Fast");
  expect(initialOptions).not.toContain("Nano Banana");

  fireEvent.click(screen.getByTestId("gen-kind-tab-image"));

  await waitFor(() => {
    const options = Array.from((screen.getByTestId("gen-model-select") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toContain("Nano Banana");
    expect(options).not.toContain("Veo 3.1 Fast");
  });
});

test("changing duration and resolution updates the live cost line", async () => {
  render(<GenerationPanel generation={makeFacade()} newId={makeNewId()} />);

  const before = screen.getByTestId("gen-cost").textContent;

  fireEvent.change(screen.getByTestId("gen-duration-select"), { target: { value: "8" } });
  await waitFor(() => expect(screen.getByTestId("gen-cost").textContent).not.toBe(before));
  const afterDuration = screen.getByTestId("gen-cost").textContent;

  fireEvent.change(screen.getByTestId("gen-resolution-select"), { target: { value: "4k" } });
  await waitFor(() => expect(screen.getByTestId("gen-cost").textContent).not.toBe(afterDuration));
});

test("empty prompt disables Generate even once a key is present", async () => {
  render(<GenerationPanel generation={makeFacade({ hasKey: true })} newId={makeNewId()} />);
  await waitFor(() => expect(screen.queryByTestId("gen-key-hint")).toBeNull());
  expect(screen.getByTestId("gen-submit")).toBeDisabled();
});

test("no key: Generate disabled with the settings hint", async () => {
  render(<GenerationPanel generation={makeFacade({ hasKey: false })} newId={makeNewId()} />);
  fireEvent.change(screen.getByTestId("gen-prompt"), { target: { value: "a foggy harbor" } });

  await waitFor(() => expect(screen.getByTestId("gen-key-hint")).toBeInTheDocument());
  expect(screen.getByTestId("gen-submit")).toBeDisabled();
});

test("numImages input clamps out-of-range and cleared values (no invalid submit possible)", async () => {
  render(<GenerationPanel generation={makeFacade()} newId={makeNewId()} />);

  fireEvent.click(screen.getByTestId("gen-kind-tab-image"));
  await waitFor(() => expect(screen.getByTestId("gen-num-images")).toBeInTheDocument());

  const input = screen.getByTestId("gen-num-images") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "5" } });
  expect(input.value).toBe("4"); // clamped to numImagesMax

  fireEvent.change(input, { target: { value: "" } });
  expect(input.value).toBe("1"); // cleared field clamps to 1, never NaN
});

test("Generate (video, valid, key): addPlaceholder + startJob with endpoint, built input, and cost estimate", async () => {
  const facade = makeFacade();
  render(<GenerationPanel generation={facade} newId={makeNewId()} />);

  await waitFor(() => expect(screen.queryByTestId("gen-key-hint")).toBeNull());
  fireEvent.change(screen.getByTestId("gen-prompt"), { target: { value: "a neon city at night" } });
  await waitFor(() => expect(screen.getByTestId("gen-submit")).not.toBeDisabled());

  await act(async () => { fireEvent.click(screen.getByTestId("gen-submit")); });

  expect(facade.addPlaceholder).toHaveBeenCalledTimes(1);
  const placeholder = facade.addPlaceholder.mock.calls[0]![0] as MediaManifestEntry;
  expect(placeholder.type).toBe("video");
  expect(placeholder.generationInput?.model).toBe("fal-ai/veo3.1/fast");
  expect(placeholder.generationInput?.prompt).toBe("a neon city at night");

  expect(facade.startJob).toHaveBeenCalledTimes(1);
  const args = facade.startJob.mock.calls[0]![0];
  expect(args.modelEndpoint).toBe("fal-ai/veo3.1/fast");
  expect(args.model).toBe("fal-ai/veo3.1/fast");
  expect(args.placeholders).toEqual([placeholder]);
  expect(args.input).toEqual({
    prompt: "a neon city at night",
    duration: "4s",
    aspect_ratio: "16:9",
    resolution: "720p",
    generate_audio: true,
  });
  expect(args.costCredits).toBe(60); // ceil(4s * 15 credits/s @ 720p)

  const status = await screen.findByTestId("gen-status");
  expect(status.textContent).toContain("Generation started");
  expect((screen.getByTestId("gen-prompt") as HTMLTextAreaElement).value).toBe("");
});

test("image numImages=3 creates 3 placeholders (outputIndex 0-2) and ONE startJob", async () => {
  const facade = makeFacade();
  render(<GenerationPanel generation={facade} newId={makeNewId()} />);

  fireEvent.click(screen.getByTestId("gen-kind-tab-image"));
  await waitFor(() => expect(screen.getByTestId("gen-num-images")).toBeInTheDocument());

  fireEvent.change(screen.getByTestId("gen-prompt"), { target: { value: "three cats" } });
  fireEvent.change(screen.getByTestId("gen-num-images"), { target: { value: "3" } });
  await waitFor(() => expect(screen.getByTestId("gen-submit")).not.toBeDisabled());

  await act(async () => { fireEvent.click(screen.getByTestId("gen-submit")); });

  expect(facade.addPlaceholder).toHaveBeenCalledTimes(3);
  const outputIndexes = facade.addPlaceholder.mock.calls.map(
    (c) => (c[0] as MediaManifestEntry).generationInput?.outputIndex,
  );
  expect(outputIndexes).toEqual([0, 1, 2]);

  expect(facade.startJob).toHaveBeenCalledTimes(1);
  const args = facade.startJob.mock.calls[0]![0];
  expect(args.placeholders).toHaveLength(3);
});

test("upscale tab: honest-disabled note, Generate stays disabled", async () => {
  render(<GenerationPanel generation={makeFacade()} newId={makeNewId()} />);

  fireEvent.click(screen.getByTestId("gen-kind-tab-upscale"));

  await waitFor(() => {
    expect(screen.getByTestId("gen-upscale-note").textContent).toContain("coming soon");
    expect(screen.getByTestId("gen-submit")).toBeDisabled();
  });
});

// ── references drop zone (M14C T3, the M10D deferral) ───────────────────────
//
// M14C follow-up ("wire imageUrls into reference-capable model inputs"): every catalogued
// image/video model now declares maxReferenceImages: 0 (WebFetch-verified — none of the 5 real
// fal endpoints accept an image/reference field on their catalogued endpoint id; see
// gen-catalog.ts). showReferences is therefore false for every real model today, so the drop
// zone itself is unreachable through this panel until a future model declares a positive cap.
// The mechanism (drag/drop, dedup, cap-trim+note, entryUrl resolution) is untouched and still
// exercised generically by GenerationPanel's own code paths — only the "which model shows it"
// wiring changed. What's tested here is the clean "not supported" reporting that replaces it.

describe("references: not supported by any current model (M14C follow-up)", () => {
  test("video tab: no zone; shows the unsupported hint naming the model", async () => {
    render(<GenerationPanel generation={makeFacade()} newId={makeNewId()} entries={() => []} />);

    expect(screen.queryByTestId("gen-references-zone")).toBeNull();
    const hint = await screen.findByTestId("gen-references-unsupported");
    expect(hint.textContent).toContain("Veo 3.1 Fast");
  });

  test("image tab: no zone; shows the unsupported hint naming the model", async () => {
    render(<GenerationPanel generation={makeFacade()} newId={makeNewId()} entries={() => []} />);
    fireEvent.click(screen.getByTestId("gen-kind-tab-image"));

    expect(screen.queryByTestId("gen-references-zone")).toBeNull();
    const hint = await screen.findByTestId("gen-references-unsupported");
    expect(hint.textContent).toContain("Nano Banana");
  });

  test("upscale tab: no zone and no unsupported hint (untouched single-source flow)", async () => {
    render(<GenerationPanel generation={makeFacade()} newId={makeNewId()} entries={() => []} />);
    fireEvent.click(screen.getByTestId("gen-kind-tab-upscale"));
    await waitFor(() => expect(screen.getByTestId("gen-upscale-note")).toBeInTheDocument());
    expect(screen.queryByTestId("gen-references-zone")).toBeNull();
    expect(screen.queryByTestId("gen-references-unsupported")).toBeNull();
  });

  test("submitting without references still works normally (no dangling reference state)", async () => {
    const facade = makeFacade();
    render(<GenerationPanel generation={facade} newId={makeNewId()} entries={() => [imageEntry("img-1")]} />);

    fireEvent.change(screen.getByTestId("gen-prompt"), { target: { value: "a neon city at night" } });
    await waitFor(() => expect(screen.getByTestId("gen-submit")).not.toBeDisabled());
    await act(async () => { fireEvent.click(screen.getByTestId("gen-submit")); });

    expect(facade.entryUrl).not.toHaveBeenCalled();
    expect(facade.startJob).toHaveBeenCalledTimes(1);
    expect(facade.startJob.mock.calls[0]![0].input).not.toHaveProperty("image_url");
  });
});
