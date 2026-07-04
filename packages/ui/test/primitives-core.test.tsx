import { describe, expect, test, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Button, IconButton, PanelHeader, SegmentedTabs } from "../src/primitives/index.js";

test("Button fires onClick, respects disabled, keeps testid", () => {
  const onClick = vi.fn();
  const r = render(<Button onClick={onClick} testid="b1">Save</Button>);
  fireEvent.click(r.getByTestId("b1"));
  expect(onClick).toHaveBeenCalledTimes(1);
  const r2 = render(<Button onClick={onClick} disabled testid="b2">Save</Button>);
  fireEvent.click(r2.getByTestId("b2"));
  expect(onClick).toHaveBeenCalledTimes(1); // unchanged
});

test("Button variants pick the right background token", () => {
  const acc = render(<Button variant="accent" testid="a">Go</Button>).getByTestId("a");
  expect(acc.style.background).toContain("--accent-primary");
  const ai = render(<Button variant="accent" gradient="ai" testid="g">Gen</Button>).getByTestId("g");
  expect(ai.style.background).toContain("--gradient-ai");
  const del = render(<Button variant="destructive" testid="d">Del</Button>).getByTestId("d");
  expect(del.style.background).toContain("--status-error");
});

test("IconButton hover/active fills follow the Swift HoverHighlight states", () => {
  const r = render(<IconButton testid="ib" active>×</IconButton>);
  const el = r.getByTestId("ib");
  expect(el.style.background).toContain("--opacity-soft");     // active, not hovered
  fireEvent.mouseEnter(el);
  expect(el.style.background).toContain("--opacity-muted");    // active + hover
});

test("PanelHeader renders title, trailing slot, 28px height token", () => {
  const r = render(<PanelHeader title="Media" trailing={<span data-testid="tr">x</span>} testid="ph" />);
  expect(r.getByText("Media")).toBeTruthy();
  expect(r.getByTestId("tr")).toBeTruthy();
  expect(r.getByTestId("ph").style.height).toContain("--size-panel-header");
});

test("SegmentedTabs selects segments and marks the active one", () => {
  const onSelect = vi.fn();
  const segs = [{ id: "media", label: "Media" }, { id: "captions", label: "Captions" }] as const;
  const r = render(<SegmentedTabs segments={segs} active="media" onSelect={onSelect} testid="tabs" />);
  fireEvent.click(r.getByTestId("tabs-captions"));
  expect(onSelect).toHaveBeenCalledWith("captions");
  expect(r.getByTestId("tabs-media").style.background).toContain("--bg-prominent");
});
