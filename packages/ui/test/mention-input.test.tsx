import { render, screen, fireEvent, act } from "@testing-library/react";
import { MentionInput, type MentionItem } from "../src/agent/MentionInput.js";
import type { MentionContext } from "@frontstage/ai";

const sampleItems: MentionItem[] = [
  { id: "m1", label: "sunrise.mp4", kind: "media", contextText: "@media sunrise.mp4 (video, 3s, id=m1)" },
  { id: "m2", label: "rain.mp4", kind: "media", contextText: "@media rain.mp4 (video, 5s, id=m2)" },
];

test("MentionInput: typing @ shows mention options", () => {
  render(
    <MentionInput
      value=""
      onChange={() => {}}
      onSend={() => {}}
      disabled={false}
      mentionItems={sampleItems}
    />,
  );

  const textarea = screen.getByTestId("agent-input");
  fireEvent.change(textarea, { target: { value: "@" } });

  expect(screen.getByTestId("agent-mention-option-0")).toBeInTheDocument();
  expect(screen.getByTestId("agent-mention-option-1")).toBeInTheDocument();
});

test("MentionInput: selecting a mention option inserts @label token", () => {
  let currentValue = "";
  const handleChange = (v: string) => { currentValue = v; };

  const { rerender } = render(
    <MentionInput
      value=""
      onChange={handleChange}
      onSend={() => {}}
      disabled={false}
      mentionItems={sampleItems}
    />,
  );

  const textarea = screen.getByTestId("agent-input");
  fireEvent.change(textarea, { target: { value: "@" } });

  fireEvent.click(screen.getByTestId("agent-mention-option-0"));

  // The onChange should have been called with the token inserted
  expect(currentValue).toContain("@sunrise.mp4");
});

test("MentionInput: onSend called with context.text when a mention is selected", async () => {
  let lastSendArgs: { text: string; ctx: MentionContext | undefined } | null = null;
  const handleSend = (text: string, ctx?: MentionContext) => { lastSendArgs = { text, ctx }; };

  let value = "";
  const handleChange = (v: string) => { value = v; };

  const { rerender } = render(
    <MentionInput
      value={value}
      onChange={handleChange}
      onSend={handleSend}
      disabled={false}
      mentionItems={sampleItems}
    />,
  );

  // Type @ to open picker
  const textarea = screen.getByTestId("agent-input");
  fireEvent.change(textarea, { target: { value: "@" } });
  expect(screen.getByTestId("agent-mention-option-0")).toBeInTheDocument();

  // Select the first item
  fireEvent.click(screen.getByTestId("agent-mention-option-0"));

  // Re-render with updated value
  rerender(
    <MentionInput
      value={value}
      onChange={handleChange}
      onSend={handleSend}
      disabled={false}
      mentionItems={sampleItems}
    />,
  );

  // Append some user text
  fireEvent.change(screen.getByTestId("agent-input"), { target: { value: `${value} tell me about it` } });

  // Click send
  await act(async () => {
    fireEvent.click(screen.getByTestId("agent-send"));
  });

  expect(lastSendArgs).not.toBeNull();
  expect(lastSendArgs!.ctx).toBeDefined();
  expect(lastSendArgs!.ctx!.text).toContain("@media sunrise.mp4");
});

test("MentionInput: onSend called with undefined context when no mention selected", async () => {
  let lastCtx: MentionContext | undefined = { text: "should-be-cleared" };
  const handleSend = (_text: string, ctx?: MentionContext) => { lastCtx = ctx; };

  render(
    <MentionInput
      value="plain message"
      onChange={() => {}}
      onSend={handleSend}
      disabled={false}
      mentionItems={sampleItems}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByTestId("agent-send"));
  });

  expect(lastCtx).toBeUndefined();
});

test("MentionInput: Enter key sends; Shift+Enter inserts newline", async () => {
  let sent = false;
  const handleSend = () => { sent = true; };

  render(
    <MentionInput
      value="hello"
      onChange={() => {}}
      onSend={handleSend}
      disabled={false}
      mentionItems={sampleItems}
    />,
  );

  const textarea = screen.getByTestId("agent-input");

  // Shift+Enter should NOT send
  await act(async () => {
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
  });
  expect(sent).toBe(false);

  // Enter (no shift) should send
  await act(async () => {
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  });
  expect(sent).toBe(true);
});
