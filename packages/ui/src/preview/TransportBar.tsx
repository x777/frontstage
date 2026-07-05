import { useState, useEffect } from "react";
import type { PlaybackEngine } from "@frontstage/engine";
import type { EditorStore } from "@frontstage/core";
import { theme } from "../theme/theme.js";
import { Icon, IconButton } from "../primitives/index.js";

interface TransportBarProps {
  engine: PlaybackEngine;
  store: EditorStore;
  fps: number;
  durationFrames: number;
}

function formatTimecode(frame: number, fps: number): string {
  const totalSec = Math.floor(frame / fps);
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  const ff = (frame % fps).toString().padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}

// All 5 transport buttons (skip-start, step-back, play/pause, step-fwd, skip-end) render SF
// Symbols at FontSize.sm (11pt) inside a 32x28 hit box in Swift, no oversized play button.
// IconButton is square, so frame="lgXl" (28px) is the closest kit match — a small glyph with
// generous hover padding, not a filled icon.
const TRANSPORT_ICON_SIZE = 14;

export function TransportBar({ engine, store, fps, durationFrames }: TransportBarProps) {
  const [engineState, setEngineState] = useState(() => ({
    currentFrame: engine.currentFrame,
    isPlaying: engine.isPlaying,
  }));

  useEffect(() => {
    return engine.onStateChange((s) => setEngineState({ ...s }));
  }, [engine]);

  function handlePlayPause() {
    if (engine.isPlaying) {
      engine.pause();
    } else {
      engine.play();
    }
  }

  function handleStepBack() {
    void engine.seek(Math.max(0, engine.currentFrame - 1), "exact");
  }

  function handleStepFwd() {
    void engine.seek(Math.min(durationFrames - 1, engine.currentFrame + 1), "exact");
  }

  function handleSeekStart() {
    void engine.seek(0, "exact");
  }

  function handleSeekEnd() {
    void engine.seek(Math.max(0, durationFrames - 1), "exact");
  }

  return (
    // 3-column grid == Swift's HStack { timecode; Spacer(); buttons; Spacer(); <right side> } —
    // the flanking tracks keep the button group centered regardless of the (currently empty)
    // trailing column, matching PreviewContainerView.transportBar exactly.
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: theme.spacing.sm,
        padding: `0 ${theme.spacing.lg}`,
        height: 36,
        flexShrink: 0,
      }}
    >
      <span
        data-testid="transport-time"
        style={{
          fontFamily: "ui-monospace, monospace",
          fontVariantNumeric: "tabular-nums",
          fontSize: theme.fontSize.sm,
        }}
      >
        <span style={{ color: theme.accent.timecode }}>{formatTimecode(engineState.currentFrame, fps)}</span>
        <span style={{ color: theme.text.tertiary }}> / </span>
        <span style={{ color: theme.text.secondary }}>{formatTimecode(durationFrames, fps)}</span>
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.md }}>
        <IconButton frame="lgXl" testid="transport-skip-start" title="Jump to start" onClick={handleSeekStart}>
          <Icon name="skip-to-start" size={TRANSPORT_ICON_SIZE} />
        </IconButton>
        <IconButton frame="lgXl" testid="transport-step-back" title="Step back 1 frame" onClick={handleStepBack}>
          <Icon name="step-back" size={TRANSPORT_ICON_SIZE} />
        </IconButton>
        <IconButton
          frame="lgXl"
          testid="transport-playpause"
          title={engineState.isPlaying ? "Pause" : "Play"}
          onClick={handlePlayPause}
        >
          <Icon name={engineState.isPlaying ? "pause" : "play"} size={TRANSPORT_ICON_SIZE} />
        </IconButton>
        <IconButton frame="lgXl" testid="transport-step-fwd" title="Step forward 1 frame" onClick={handleStepFwd}>
          <Icon name="step-forward" size={TRANSPORT_ICON_SIZE} />
        </IconButton>
        <IconButton frame="lgXl" testid="transport-skip-end" title="Jump to end" onClick={handleSeekEnd}>
          <Icon name="skip-to-end" size={TRANSPORT_ICON_SIZE} />
        </IconButton>
      </div>
    </div>
  );
}
