import React, { useRef, useState } from "react";
import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";
import { Icon, IconButton, type IconName } from "../primitives/index.js";
import {
  RULER_HEIGHT,
  DEFAULT_TRACK_HEIGHT,
  toggleTrackMuteCommand,
  toggleTrackHiddenCommand,
  toggleTrackSyncLockCommand,
  reorderTrackCommand,
  setTrackNameCommand,
  timelineTrackDisplayLabel,
  normalizeTrackName,
  TRACK_NAME_MAX_LENGTH,
  type EditorStore,
} from "@frontstage/core";

export const TRACK_HEADER_WIDTH = 100;

// Row icons per TimelineHeaderView.swift (iconSize 14pt there; xxs frame here is the kit's
// smallest button, per the M16C T2 brief).
const ROW_ICON_SIZE = 10;

export function TrackHeaders({ store }: { store: EditorStore }) {
  const timeline = useStore(store, (s) => s.timeline);
  const tracks = timeline.tracks;
  const listRef = useRef<HTMLDivElement>(null);
  const [dragTrackId, setDragTrackId] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: string; draft: string } | null>(null);
  const renameRef = useRef(rename);
  renameRef.current = rename;

  function commitRename(save: boolean): void {
    const current = renameRef.current;
    if (!current) return;
    renameRef.current = null;
    if (save) {
      const parsed = normalizeTrackName(current.draft);
      if (parsed.ok) store.dispatch(setTrackNameCommand(current.id, parsed.name ?? ""));
    }
    setRename(null);
  }

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

  // Visual tracks are always clamped above every audio track (EditorViewModel+Tracks.swift), so
  // the first "audio"-typed row marks the video/audio zone boundary for the divider below.
  const firstAudioIndex = tracks.findIndex((t) => t.type === "audio");
  const hasZoneDivider = firstAudioIndex > 0;

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
        zIndex: theme.z.raised,
        overflow: "hidden",
      }}
    >
      {tracks.map((track, i) => {
        const isAudio = track.type === "audio";
        const toggleBtn = isAudio
          ? {
              testid: `track-mute-${track.id}`,
              on: track.muted,
              active: !track.muted,
              label: track.muted ? "Unmute" : "Mute",
              icon: (track.muted ? "volume-off" : "volume") as IconName,
              cmd: () => store.dispatch(toggleTrackMuteCommand(track.id)),
            }
          : {
              testid: `track-hide-${track.id}`,
              on: track.hidden,
              active: !track.hidden,
              label: track.hidden ? "Show" : "Hide",
              icon: (track.hidden ? "eye-off" : "eye") as IconName,
              cmd: () => store.dispatch(toggleTrackHiddenCommand(track.id)),
            };
        const isDragging = dragTrackId === track.id;
        return (
          <div
            key={track.id}
            data-testid="track-header-row"
            style={{
              height: DEFAULT_TRACK_HEIGHT,
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.sm,
              paddingLeft: theme.spacing.sm,
              paddingRight: theme.spacing.sm,
              boxSizing: "border-box",
              borderLeft: `${theme.size.trackStrip} solid ${theme.track[track.type]}`,
              borderBottom: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
              borderTop: i === firstAudioIndex && hasZoneDivider ? `${theme.borderWidth.thick} solid ${theme.border.divider}` : undefined,
              background: isDragging ? theme.bg.prominent : undefined,
            }}
          >
            <span
              data-testid={`track-grip-${track.id}`}
              onPointerDown={(e) => onGripPointerDown(e, track.id)}
              onPointerMove={(e) => onGripPointerMove(e, track.id)}
              onPointerUp={onGripPointerUp}
              onPointerCancel={onGripPointerUp}
              style={{ display: "flex", cursor: isDragging ? "grabbing" : "grab", color: theme.text.muted, touchAction: "none" }}
            >
              <Icon name="grip" size={ROW_ICON_SIZE} />
            </span>
            {rename?.id === track.id ? (
              <input
                data-testid={`track-rename-${track.id}`}
                value={rename.draft}
                maxLength={TRACK_NAME_MAX_LENGTH}
                autoFocus
                onChange={(e) => setRename({ id: track.id, draft: e.target.value })}
                onBlur={() => commitRename(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(true);
                  }
                  if (e.key === "Escape") commitRename(false);
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: theme.text.secondary,
                  fontSize: theme.fontSize.sm,
                  fontWeight: theme.fontWeight.medium,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  padding: 0,
                }}
              />
            ) : (
              <span
                data-testid={`track-label-${track.id}`}
                title={track.name ? `${track.name} (${timelineTrackDisplayLabel(timeline, i)})` : timelineTrackDisplayLabel(timeline, i)}
                onDoubleClick={() => setRename({ id: track.id, draft: track.name ?? "" })}
                style={{
                  flex: 1,
                  color: theme.text.secondary,
                  fontSize: theme.fontSize.sm,
                  fontWeight: theme.fontWeight.medium,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {track.name ?? timelineTrackDisplayLabel(timeline, i)}
              </span>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs }}>
              <IconButton
                frame="xs"
                testid={`track-synclock-${track.id}`}
                ariaPressed={track.syncLocked}
                active={track.syncLocked}
                title={track.syncLocked ? "Unlock Sync" : "Sync Lock"}
                onClick={() => store.dispatch(toggleTrackSyncLockCommand(track.id))}
              >
                <Icon name={track.syncLocked ? "lock" : "lock-open"} size={ROW_ICON_SIZE} />
              </IconButton>
              <IconButton frame="xs" testid={toggleBtn.testid} ariaPressed={toggleBtn.on} active={toggleBtn.active} title={toggleBtn.label} onClick={toggleBtn.cmd}>
                <Icon name={toggleBtn.icon} size={ROW_ICON_SIZE} />
              </IconButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
