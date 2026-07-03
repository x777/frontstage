import { render, screen, within } from "@testing-library/react";
import type { MediaManifestEntry } from "@palmier/core";
import { MediaPanel } from "../src/media/MediaPanel.js";

function fakeLibrary(entries: MediaManifestEntry[]) {
  return {
    getSnapshot: () => ({ entries }),
    subscribe: () => () => {},
    thumbnail: (id: string) => `${id}-thumb.png`,
    importFiles: async () => [],
    entry: (id: string) => entries.find((e) => e.id === id),
  };
}

function baseEntry(id: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 5,
    ...overrides,
  };
}

test("normal entry renders unchanged: thumbnail, no overlay, no failed state", () => {
  render(<MediaPanel library={fakeLibrary([baseEntry("a")])} />);
  const item = screen.getByTestId("media-item");
  expect(within(item).getByRole("img")).toBeInTheDocument();
  expect(within(item).queryByTestId("generating-overlay")).toBeNull();
  expect(within(item).queryByTestId("media-item-failed")).toBeNull();
  expect(item).toHaveTextContent("a.mp4");
});

test("generating entry renders the overlay and suppresses the thumbnail + hover actions", () => {
  render(<MediaPanel library={fakeLibrary([baseEntry("a", { generationStatus: "generating" })])} />);
  const item = screen.getByTestId("media-item");
  expect(within(item).getByTestId("generating-overlay")).toHaveTextContent("Generating...");
  expect(within(item).queryByRole("img")).toBeNull();
  expect(within(item).queryByRole("button")).toBeNull();
});

test("preparing/downloading/rendering entries map to their in-flight labels", () => {
  render(
    <MediaPanel
      library={fakeLibrary([
        baseEntry("a", { generationStatus: "preparing" }),
        baseEntry("b", { generationStatus: "downloading" }),
        baseEntry("c", { generationStatus: "rendering" }),
      ])}
    />,
  );
  const items = screen.getAllByTestId("media-item");
  expect(items[0]).toHaveTextContent("Preparing...");
  expect(items[1]).toHaveTextContent("Downloading...");
  expect(items[2]).toHaveTextContent("Rendering...");
});

test("failed entry shows the Failed state with the message and a title attr, no overlay", () => {
  render(<MediaPanel library={fakeLibrary([baseEntry("a", { generationStatus: "failed: network timeout" })])} />);
  const item = screen.getByTestId("media-item");
  expect(within(item).queryByTestId("generating-overlay")).toBeNull();
  const failedEl = within(item).getByTestId("media-item-failed");
  expect(item).toHaveTextContent("Failed");
  expect(item).toHaveTextContent("network timeout");
  expect(failedEl).toHaveAttribute("title", "network timeout");
});
