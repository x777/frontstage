import { useState, useEffect } from "react";
import type { PlaybackEngine } from "@palmier/engine";
import type { EditorStore } from "@palmier/core";
import { theme } from "../theme/theme.js";

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

  const btnStyle: React.CSSProperties = {
    background: theme.bg.raised,
    border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
    borderRadius: theme.radius.xs,
    color: theme.text.primary,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
    lineHeight: 1,
    minWidth: theme.iconSize.lgXl,
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
        background: theme.bg.prominent,
        borderTop: `${theme.borderWidth.thin} solid ${theme.border.divider}`,
        flexShrink: 0,
      }}
    >
      <button
        data-testid="transport-step-back"
        onClick={handleStepBack}
        style={btnStyle}
        title="Step back 1 frame"
      >
        ◀
      </button>
      <button
        data-testid="transport-playpause"
        onClick={handlePlayPause}
        style={{ ...btnStyle, minWidth: theme.size.transportPlay }}
        title={engineState.isPlaying ? "Pause" : "Play"}
      >
        {engineState.isPlaying ? "⏸" : "▶"}
      </button>
      <button
        data-testid="transport-step-fwd"
        onClick={handleStepFwd}
        style={btnStyle}
        title="Step forward 1 frame"
      >
        ▶
      </button>
      <span
        data-testid="transport-time"
        style={{
          fontFamily: "monospace",
          fontSize: theme.fontSize.xs,
          color: theme.accent.timecode,
          marginLeft: theme.spacing.xs,
        }}
      >
        {formatTimecode(engineState.currentFrame, fps)} / {formatTimecode(durationFrames, fps)}
      </span>
    </div>
  );
}
