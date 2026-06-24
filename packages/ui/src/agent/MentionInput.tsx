import { useState, useRef, type KeyboardEvent } from "react";
import type { MentionContext } from "@palmier/ai";
import { theme } from "../theme/theme.js";

export interface MentionItem {
  id: string;
  label: string;
  kind: "media" | "clip";
  contextText: string;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string, context?: MentionContext) => void;
  disabled?: boolean;
  mentionItems: MentionItem[];
}

export function MentionInput({ value, onChange, onSend, disabled, mentionItems }: MentionInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenItems, setChosenItems] = useState<MentionItem[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track the live text value so selection logic uses the most recent input
  const liveValueRef = useRef(value);
  liveValueRef.current = value;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newVal = e.target.value;
    // Keep liveValueRef in sync with what's actually in the DOM
    liveValueRef.current = newVal;
    onChange(newVal);
    const atIdx = newVal.lastIndexOf("@");
    if (atIdx >= 0) {
      const suffix = newVal.slice(atIdx + 1);
      // Open if @ is at end or followed by a short non-space query
      if (suffix.indexOf(" ") === -1 && suffix.length <= 30) {
        setPickerOpen(true);
        return;
      }
    }
    setPickerOpen(false);
  }

  function handleSelectMention(item: MentionItem) {
    const current = liveValueRef.current;
    const atIdx = current.lastIndexOf("@");
    const before = atIdx >= 0 ? current.slice(0, atIdx) : current;
    const token = `@${item.label}`;
    const next = before + token + " ";
    liveValueRef.current = next;
    onChange(next);
    setChosenItems((prev) => [...prev, item]);
    setPickerOpen(false);
    textareaRef.current?.focus();
  }

  function handleSend() {
    const text = liveValueRef.current.trim();
    if (!text || disabled) return;
    const context: MentionContext | undefined =
      chosenItems.length > 0
        ? { text: chosenItems.map((m) => m.contextText).join("\n") }
        : undefined;
    onSend(text, context);
    setChosenItems([]);
    setPickerOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = liveValueRef.current.trim().length > 0 && !disabled;

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
      {pickerOpen && mentionItems.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            right: 0,
            background: theme.bg.raised,
            border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
            borderRadius: theme.radius.sm,
            maxHeight: theme.size.mentionPickerMax,
            overflowY: "auto",
            zIndex: theme.z.menu,
            marginBottom: theme.spacing.xxs,
          }}
        >
          {mentionItems.map((item, i) => (
            <button
              key={item.id}
              data-testid={`agent-mention-option-${i}`}
              onMouseDown={(e) => e.preventDefault()} // prevent textarea blur
              onClick={() => handleSelectMention(item)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.spacing.xs,
                width: "100%",
                background: "none",
                border: "none",
                borderBottom:
                  i < mentionItems.length - 1
                    ? `${theme.borderWidth.hairline} solid ${theme.border.divider}`
                    : "none",
                color: theme.text.primary,
                cursor: "pointer",
                fontSize: theme.fontSize.xs,
                padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
                textAlign: "left",
              }}
            >
              <span
                style={{
                  fontSize: theme.fontSize.micro,
                  color: theme.text.muted,
                  border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
                  borderRadius: theme.radius.xs,
                  padding: `0 ${theme.spacing.xxs}`,
                  flexShrink: 0,
                }}
              >
                {item.kind}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: theme.spacing.xs,
        }}
      >
        <textarea
          ref={textareaRef}
          data-testid="agent-input"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            background: theme.bg.surface,
            color: theme.text.primary,
            border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
            borderRadius: theme.radius.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.regular,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <button
          data-testid="agent-send"
          onClick={handleSend}
          disabled={!canSend}
          style={{
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            background: canSend ? theme.accent.primary : theme.bg.raised,
            color: canSend ? theme.text.onAccent : theme.text.muted,
            border: "none",
            borderRadius: theme.radius.sm,
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.medium,
            cursor: canSend ? "pointer" : "not-allowed",
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
