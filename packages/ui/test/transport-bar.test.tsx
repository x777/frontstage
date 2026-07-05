import { expect, test, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { PlaybackEngine } from "@frontstage/engine";
import { EditorStore, defaultTimeline } from "@frontstage/core";
import { TransportBar } from "../src/preview/TransportBar.js";

function fakeEngine(): PlaybackEngine {
  return {
    currentFrame: 10,
    isPlaying: false,
    onStateChange: () => () => {},
    seek: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
  } as unknown as PlaybackEngine;
}

test("skip-to-start seeks to frame 0", () => {
  const engine = fakeEngine();
  const store = new EditorStore(defaultTimeline());
  const r = render(<TransportBar engine={engine} store={store} fps={30} durationFrames={300} />);
  fireEvent.click(r.getByTestId("transport-skip-start"));
  expect(engine.seek).toHaveBeenCalledWith(0, "exact");
});

test("skip-to-end seeks to durationFrames - 1", () => {
  const engine = fakeEngine();
  const store = new EditorStore(defaultTimeline());
  const r = render(<TransportBar engine={engine} store={store} fps={30} durationFrames={300} />);
  fireEvent.click(r.getByTestId("transport-skip-end"));
  expect(engine.seek).toHaveBeenCalledWith(299, "exact");
});
