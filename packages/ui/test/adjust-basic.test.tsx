import { render, screen, fireEvent, act } from "@testing-library/react";
import { AdjustmentRow } from "../src/inspector/adjust/index.js";
import { AdjustSection } from "../src/inspector/adjust/index.js";
import { ScrubbableNumberField } from "../src/inspector/adjust/index.js";

const fmt = (v: number) => v.toFixed(2);

test("adjustmentRow renders label and formatted value", () => {
  render(
    <AdjustmentRow
      label="Exposure"
      value={1.5}
      min={-3}
      max={3}
      def={0}
      onChange={() => {}}
      onCommit={() => {}}
      format={fmt}
    />,
  );
  expect(screen.getByText("Exposure")).toBeInTheDocument();
  expect(screen.getByText("1.50")).toBeInTheDocument();
});

test("adjustmentRow shows — for null value", () => {
  render(
    <AdjustmentRow
      label="Exposure"
      value={null}
      min={-3}
      max={3}
      def={0}
      onChange={() => {}}
      onCommit={() => {}}
      format={fmt}
    />,
  );
  expect(screen.getByText("—")).toBeInTheDocument();
});

test("ArrowRight on AdjustSlider calls onChange then onCommit", () => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <AdjustmentRow
      label="Exposure"
      value={0}
      min={-3}
      max={3}
      def={0}
      onChange={onChange}
      onCommit={onCommit}
      format={fmt}
    />,
  );
  const slider = screen.getByRole("slider");
  act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
  // step = (max - min) * 0.01 = 6 * 0.01 = 0.06; value(0) + step = 0.06
  expect(onChange).toHaveBeenCalledWith(expect.closeTo(0.06, 5));
  expect(onCommit).toHaveBeenCalled();
});

test("ArrowLeft on AdjustSlider calls onChange with a lower value", () => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <AdjustmentRow
      label="Exposure"
      value={0}
      min={-3}
      max={3}
      def={0}
      onChange={onChange}
      onCommit={onCommit}
      format={fmt}
    />,
  );
  const slider = screen.getByRole("slider");
  act(() => { fireEvent.keyDown(slider, { key: "ArrowLeft" }); });
  const called = onChange.mock.calls[0]![0] as number;
  expect(called).toBeLessThan(0);
  expect(onCommit).toHaveBeenCalled();
});

test("AdjustSlider double-click resets to def", () => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <AdjustmentRow
      label="Exposure"
      value={2}
      min={-3}
      max={3}
      def={0}
      onChange={onChange}
      onCommit={onCommit}
      format={fmt}
    />,
  );
  const slider = screen.getByRole("slider");
  act(() => { fireEvent.doubleClick(slider); });
  expect(onChange).toHaveBeenCalledWith(0);
  expect(onCommit).toHaveBeenCalled();
});

test("AdjustSlider aria-valuenow reflects value", () => {
  render(
    <AdjustmentRow
      label="Exposure"
      value={1.5}
      min={-3}
      max={3}
      def={0}
      onChange={() => {}}
      onCommit={() => {}}
      format={fmt}
    />,
  );
  const slider = screen.getByRole("slider");
  expect(slider).toHaveAttribute("aria-valuenow", "1.5");
});

test("AdjustSection hides children when expanded=false", () => {
  render(
    <AdjustSection
      title="Basic"
      expanded={false}
      onToggle={() => {}}
      canReset={false}
      onReset={() => {}}
      enabled={true}
      onToggleEnabled={() => {}}
      canEnable={true}
    >
      <span data-testid="child-content">content</span>
    </AdjustSection>,
  );
  expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
});

test("AdjustSection shows children when expanded=true", () => {
  render(
    <AdjustSection
      title="Basic"
      expanded={true}
      onToggle={() => {}}
      canReset={false}
      onReset={() => {}}
      enabled={true}
      onToggleEnabled={() => {}}
      canEnable={true}
    >
      <span data-testid="child-content">content</span>
    </AdjustSection>,
  );
  expect(screen.getByTestId("child-content")).toBeInTheDocument();
});

test("AdjustSection header click calls onToggle", () => {
  const onToggle = vi.fn();
  render(
    <AdjustSection
      title="Basic"
      expanded={false}
      onToggle={onToggle}
      canReset={false}
      onReset={() => {}}
      enabled={true}
      onToggleEnabled={() => {}}
      canEnable={true}
    >
      <span>content</span>
    </AdjustSection>,
  );
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Basic")); });
  expect(onToggle).toHaveBeenCalledOnce();
});

test("AdjustSection reset button fires onReset when canReset=true", () => {
  const onReset = vi.fn();
  const onToggle = vi.fn();
  render(
    <AdjustSection
      title="Basic"
      expanded={false}
      onToggle={onToggle}
      canReset={true}
      onReset={onReset}
      enabled={true}
      onToggleEnabled={() => {}}
      canEnable={true}
    >
      <span>content</span>
    </AdjustSection>,
  );
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-reset-Basic")); });
  expect(onReset).toHaveBeenCalledOnce();
  expect(onToggle).not.toHaveBeenCalled();
});

test("AdjustSection reset button absent when canReset=false", () => {
  render(
    <AdjustSection
      title="Basic"
      expanded={false}
      onToggle={() => {}}
      canReset={false}
      onReset={() => {}}
      enabled={true}
      onToggleEnabled={() => {}}
      canEnable={true}
    >
      <span>content</span>
    </AdjustSection>,
  );
  expect(screen.queryByTestId("adjust-section-reset-Basic")).not.toBeInTheDocument();
});

test("AdjustSection enable checkbox fires onToggleEnabled", () => {
  const onToggleEnabled = vi.fn();
  const onToggle = vi.fn();
  render(
    <AdjustSection
      title="Basic"
      expanded={false}
      onToggle={onToggle}
      canReset={false}
      onReset={() => {}}
      enabled={true}
      onToggleEnabled={onToggleEnabled}
      canEnable={true}
    >
      <span>content</span>
    </AdjustSection>,
  );
  const checkbox = screen.getByTestId("adjust-section-enable-Basic");
  act(() => { fireEvent.click(checkbox); });
  expect(onToggleEnabled).toHaveBeenCalledOnce();
  expect(onToggle).not.toHaveBeenCalled();
});

test("ScrubbableNumberField Esc cancels edit without calling onChange or onCommit", () => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <ScrubbableNumberField
      value={1.5}
      min={-3}
      max={3}
      onChange={onChange}
      onCommit={onCommit}
      format={fmt}
    />,
  );
  const field = screen.getByTestId("scrub-field");
  field.setPointerCapture = vi.fn();
  act(() => { fireEvent.pointerDown(field, { pointerId: 1, clientX: 100 }); });
  act(() => { fireEvent.pointerUp(field, { pointerId: 1, clientX: 100 }); });
  const input = screen.getByTestId("scrub-field-input");
  act(() => { fireEvent.change(input, { target: { value: "2.50" } }); });
  act(() => { fireEvent.keyDown(input, { key: "Escape" }); });
  expect(onChange).not.toHaveBeenCalled();
  expect(onCommit).not.toHaveBeenCalled();
  expect(screen.getByTestId("scrub-field")).toHaveTextContent("1.50");
});

test("ScrubbableNumberField clamps value to max on Enter", () => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <ScrubbableNumberField
      value={1.5}
      min={-3}
      max={3}
      onChange={onChange}
      onCommit={onCommit}
      format={fmt}
    />,
  );
  const field = screen.getByTestId("scrub-field");
  field.setPointerCapture = vi.fn();
  act(() => { fireEvent.pointerDown(field, { pointerId: 1, clientX: 100 }); });
  act(() => { fireEvent.pointerUp(field, { pointerId: 1, clientX: 100 }); });
  const input = screen.getByTestId("scrub-field-input");
  act(() => { fireEvent.change(input, { target: { value: "999" } }); });
  act(() => { fireEvent.keyDown(input, { key: "Enter" }); });
  expect(onChange).toHaveBeenCalledWith(3);
  expect(onCommit).toHaveBeenCalled();
});
