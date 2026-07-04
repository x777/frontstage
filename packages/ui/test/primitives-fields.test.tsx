import { describe, expect, test, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TextInput, Checkbox, MenuList, Dialog, Select } from "../src/primitives/index.js";

test("TextInput emits onChange strings and flips border color on focus", () => {
  const onChange = vi.fn();
  const r = render(<TextInput value="" onChange={onChange} testid="ti" />);
  const el = r.getByTestId("ti") as HTMLInputElement;
  fireEvent.change(el, { target: { value: "abc" } });
  expect(onChange).toHaveBeenCalledWith("abc");
  fireEvent.focus(el);
  expect(el.style.borderColor).toContain("--accent-primary");
});

test("Checkbox toggles and renders its label", () => {
  const onChange = vi.fn();
  const r = render(<Checkbox checked={false} onChange={onChange} label="Mute" testid="cb" />);
  fireEvent.click(r.getByTestId("cb"));
  expect(onChange).toHaveBeenCalledWith(true);
  expect(r.getByText("Mute")).toBeTruthy();
});

test("MenuList selects rows; disabled rows do not fire; destructive rows use the error token", () => {
  const onSelect = vi.fn();
  const items = [
    { id: "open", label: "Open" },
    { id: "del", label: "Delete", destructive: true },
    { id: "off", label: "Off", disabled: true },
  ] as const;
  const r = render(<MenuList items={items} onSelect={onSelect} testid="m" />);
  fireEvent.click(r.getByTestId("m-open"));
  expect(onSelect).toHaveBeenCalledWith("open");
  fireEvent.click(r.getByTestId("m-off"));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(r.getByTestId("m-del").style.color).toContain("--status-error");
});

test("Dialog: scrim click closes, panel click does not", () => {
  const onClose = vi.fn();
  const r = render(<Dialog title="T" onClose={onClose} testid="dlg"><span>body</span></Dialog>);
  fireEvent.click(r.getByTestId("dlg-panel"));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(r.getByTestId("dlg-scrim"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Select still works from its new home (moved API unchanged)", () => {
  const onChange = vi.fn();
  const r = render(
    <Select value={null} placeholder="pick" onChange={onChange} testid="sel"
      options={[{ value: "a", label: "A" }]} />,
  );
  fireEvent.change(r.getByTestId("sel"), { target: { value: "a" } });
  expect(onChange).toHaveBeenCalledWith("a");
});
