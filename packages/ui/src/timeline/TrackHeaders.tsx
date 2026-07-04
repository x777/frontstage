import React, { useRef, useState } from "react";
import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";
import {
  RULER_HEIGHT,
  DEFAULT_TRACK_HEIGHT,
  toggleTrackMuteCommand,
  toggleTrackHiddenCommand,
  toggleTrackSyncLockCommand,
  reorderTrackCommand,
  type EditorStore,
} from "@palmier/core";

export const TRACK_HEADER_WIDTH = 160;

export function TrackHeaders({ store }: { store: EditorStore }) {
  const tracks = useStore(store, (s) => s.timeline.tracks);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragTrackId, setDragTrackId] = useState<string | null>(null);

  function targetIndexForY(clientY: number): number {
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    return Math.max(0, Math.floor((clientY - top) / DEFAULT_TRACK_HEIGHT));
  }

  function onGripPointerDown(e: React.PointerEvent, trackId: string): void {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // A selected gap stores a raw trackIndex, which a reorder can repoint at a different track —
    // clear it defensively (a no-op today; gap selection has no UI entry point yet).
    store.setSelectedGap(null);
    setDragTrackId(trackId);
  }
  function onGripPointerMove(e: React.PointerEvent, trackId: string): void {
    if (dragTrackId !== trackId) return;
    // Live reshuffle, coalesced to one undo step on release (same key for the whole gesture).
    store.dispatch(reorderTrackCommand(trackId, targetIndexForY(e.clientY), `reorder-${trackId}`));
  }
  function onGripPointerUp(e: React.PointerEvent): void {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragTrackId(null);
  }

  return (
    <div
      ref={listRef}
      data-testid="track-headers"
      style={{
        position: "absolute",
        left: 0,
        top: RULER_HEIGHT,
        width: TRACK_HEADER_WIDTH,
        bottom: 0,
        background: theme.bg.surface,
        borderRight: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
        zIndex: 2,
        overflow: "hidden",
      }}
    >
      {tracks.map((track, i) => {
        const isAudio = track.type === "audio";
        const toggleBtn = isAudio
          ? { testid: `track-mute-${track.id}`, on: track.muted, label: track.muted ? "Unmute" : "Mute", glyph: track.muted ? "🔇" : "🔊", cmd: () => store.dispatch(toggleTrackMuteCommand(track.id)) }
          : { testid: `track-hide-${track.id}`, on: track.hidden, label: track.hidden ? "Show" : "Hide", glyph: track.hidden ? "🚫" : "👁", cmd: () => store.dispatch(toggleTrackHiddenCommand(track.id)) };
        const isDragging = dragTrackId === track.id;
        return (
          <div
            key={track.id}
            data-testid="track-header-row"
            style={{
              height: DEFAULT_TRACK_HEIGHT,
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.xs,
              padding: `0 ${theme.spacing.sm}`,
              borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
              boxSizing: "border-box",
              background: isDragging ? theme.bg.raised : undefined,
            }}
          >
            <span
              data-testid={`track-grip-${track.id}`}
              onPointerDown={(e) => onGripPointerDown(e, track.id)}
              onPointerMove={(e) => onGripPointerMove(e, track.id)}
              onPointerUp={onGripPointerUp}
              onPointerCancel={onGripPointerUp}
              style={{ cursor: isDragging ? "grabbing" : "grab", color: theme.text.muted, fontSize: theme.fontSize.sm, touchAction: "none" }}
            >
              &#x2807;
            </span>
            <span style={{ flex: 1, color: theme.text.primary, fontSize: theme.fontSize.sm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {track.type} {i + 1}
            </span>
            <button
              data-testid={toggleBtn.testid}
              aria-pressed={toggleBtn.on}
              title={toggleBtn.label}
              onClick={toggleBtn.cmd}
              style={headerButtonStyle(toggleBtn.on)}
            >
              {toggleBtn.glyph}
            </button>
            <button
              data-testid={`track-synclock-${track.id}`}
              aria-pressed={track.syncLocked}
              title={track.syncLocked ? "Unlock Sync" : "Sync Lock"}
              onClick={() => store.dispatch(toggleTrackSyncLockCommand(track.id))}
              style={headerButtonStyle(track.syncLocked)}
            >
              {track.syncLocked ? "🔒" : "🔓"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function headerButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? theme.bg.raised : "transparent",
    color: active ? theme.text.primary : theme.text.muted,
    border: "none",
    borderRadius: theme.radius.xs,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    padding: theme.spacing.xxs,
    lineHeight: 1,
  };
}
