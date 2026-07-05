import { render, screen, fireEvent } from "@testing-library/react";
import { ModelPicker } from "../src/agent/ModelPicker.js";
import type { ModelEntry } from "@frontstage/ai";

const MODELS: ModelEntry[] = [
  { id: "a/model-1", label: "Model One", kind: "llm" },
  { id: "b/model-2", label: "Model Two", kind: "llm" },
];

test("ModelPicker renders model labels as options", () => {
  render(<ModelPicker models={MODELS} value="a/model-1" onChange={vi.fn()} />);
  const select = screen.getByTestId("model-picker") as HTMLSelectElement;
  expect(select.options[0]!.text).toBe("Model One");
  expect(select.options[1]!.text).toBe("Model Two");
});

test("ModelPicker shows current value", () => {
  render(<ModelPicker models={MODELS} value="b/model-2" onChange={vi.fn()} />);
  const select = screen.getByTestId("model-picker") as HTMLSelectElement;
  expect(select.value).toBe("b/model-2");
});

test("ModelPicker fires onChange with selected id", () => {
  const onChange = vi.fn();
  render(<ModelPicker models={MODELS} value="a/model-1" onChange={onChange} />);
  const select = screen.getByTestId("model-picker");
  fireEvent.change(select, { target: { value: "b/model-2" } });
  expect(onChange).toHaveBeenCalledWith("b/model-2");
});

test("ModelPicker uses custom testid", () => {
  render(<ModelPicker models={MODELS} value="a/model-1" onChange={vi.fn()} testid="my-picker" />);
  expect(screen.getByTestId("my-picker")).toBeInTheDocument();
});
