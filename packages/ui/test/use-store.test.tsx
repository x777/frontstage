import { render, screen, act } from "@testing-library/react";
import { EditorStore, defaultTimeline } from "@frontstage/core";
import { useStore } from "../src/store/use-store.js";

function Playhead({ store }: { store: EditorStore }) {
  const ph = useStore(store, (s) => s.playhead);
  return <div data-testid="ph">{ph}</div>;
}

test("useStore re-renders on store change", () => {
  const store = new EditorStore(defaultTimeline());
  render(<Playhead store={store} />);
  expect(screen.getByTestId("ph").textContent).toBe("0");
  act(() => store.setPlayhead(42));
  expect(screen.getByTestId("ph").textContent).toBe("42");
});
