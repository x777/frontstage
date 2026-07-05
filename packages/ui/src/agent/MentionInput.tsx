import { useState, useRef, type KeyboardEvent } from "react";
import type { MentionContext } from "@frontstage/ai";
import { theme } from "../theme/theme.js";
import { Button, Icon, useHover } from "../primitives/index.js";

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

// AgentInputBox.sendStopButton renders its glyph at IconSize.sm (18) inside a circular chrome —
// the transport bar's precedent (TRANSPORT_ICON_SIZE) for a smaller glyph within a larger hit box.
const SEND_ICON_SIZE = 14;

function MentionOption({
  item,
  index,
  isLast,
  onPick,
}: {
  item: MentionItem;
  index: number;
  isLast: boolean;
  onPick: (item: MentionItem) => void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <button
      data-testid={`agent-mention-option-${index}`}
      onMouseDown={(e) => e.preventDefault()} // prevent textarea blur
      onClick={() => onPick(item)}
      {...hoverProps}
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        width: "100%",
        background: hovered ? `rgba(255, 255, 255, ${theme.opacity.soft})` : "none",
        border: "none",
        borderBottom: isLast ? "none" : `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
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
  );
}

export function MentionInput({ value, onChange, onSend, disabled, mentionItems }: MentionInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenItems, setChosenItems] = useState<MentionItem[]>([]);
  const [focused, setFocused] = useState(false);
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
            <MentionOption
              key={item.id}
              item={item}
              index={i}
              isLast={i === mentionItems.length - 1}
              onPick={handleSelectMention}
            />
          ))}
        </div>
      )}

      {/* AgentInputBox's glass rounded-xl card: textField on top, a hairline divider, then the
          bottom bar. Our composer has no leadingTools slot (the model picker/skills button live
          in AgentPanel's own header instead), so the bottom bar is just the send affordance. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: theme.bg.surface,
          borderRadius: theme.radius.xl,
          borderWidth: focused ? theme.borderWidth.thin : theme.borderWidth.hairline,
          borderStyle: "solid",
          borderColor: focused ? theme.accent.primary : theme.border.primary,
          transition: `border-color ${theme.anim.hover} ease-out`,
        }}
      >
        <textarea
          ref={textareaRef}
          data-testid="agent-input"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          rows={1}
          placeholder="Ask, or type @ to reference media"
          style={{
            background: "none",
            color: theme.text.primary,
            border: "none",
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            fontSize: theme.fontSize.md,
            fontWeight: theme.fontWeight.regular,
            padding: `${theme.spacing.smMd} ${theme.spacing.mdLg} ${theme.spacing.xs}`,
            minHeight: theme.size.composerInputMinH,
            maxHeight: theme.size.composerInputMaxH,
            overflowY: "auto",
          }}
        />
        <div style={{ height: theme.borderWidth.hairline, background: theme.border.subtle, flexShrink: 0 }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          }}
        >
          <Button
            testid="agent-send"
            onClick={handleSend}
            disabled={!canSend}
            variant="accent"
            shape="capsule"
            title="Send"
            style={{
              width: theme.iconSize.xl,
              height: theme.iconSize.xl,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="send" size={SEND_ICON_SIZE} />
          </Button>
        </div>
      </div>
    </div>
  );
}
