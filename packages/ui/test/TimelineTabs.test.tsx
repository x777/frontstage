import { describe, expect, test } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { EditorStore, defaultTimeline } from "@frontstage/core";
import { TimelineTabs } from "../src/timeline/TimelineTabs.js";

describe("TimelineTabs", () => {
  test("hidden when the project has one timeline", () => {
    const store = new EditorStore(defaultTimeline());
    const { queryByRole } = render(<TimelineTabs store={store} />);
    expect(queryByRole("tablist")).toBeNull();
  });

  test("shows tabs after createTimeline and switches on click", () => {
    const store = new EditorStore(defaultTimeline());
    store.createTimeline("Alt");
    const { getByRole, getByText } = render(<TimelineTabs store={store} />);
    expect(getByRole("tablist")).toBeTruthy();
    fireEvent.click(getByText("Timeline 1"));
    expect(store.getSnapshot().timeline.name).toBe("Timeline 1");
  });
});
