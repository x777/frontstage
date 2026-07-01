import { render, screen, fireEvent, act } from "@testing-library/react";
import { AdjustmentRow } from "../src/inspector/adjust/index.js";
import { AdjustSection } from "../src/inspector/adjust/index.js";

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
  expect(onChange).toHaveBeenCalledWith(expect.any(Number));
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
  render(
    <AdjustSection
      title="Basic"
      expanded={false}
      onToggle={() => {}}
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
  render(
    <AdjustSection
      title="Basic"
      expanded={false}
      onToggle={() => {}}
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
});
