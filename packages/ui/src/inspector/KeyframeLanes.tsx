import { useRef, useCallback } from "react";
import type { EditorStore, Clip, KeyframeTrackKey } from "@palmier/core";
import {
  opacityAt,
  rotationAt,
  sizeAt,
  topLeftAt,
  cropAt,
  setKeyframeCommand,
  removeKeyframeCommand,
} from "@palmier/core";
import type { KeyframeValueMap } from "@palmier/core";
import { theme } from "../theme/theme.js";

// Mirrors --size-kf-diamond; needed as a number for hit-test geometry.
const DIAMOND_PX = 10;

type Prop = "opacity" | "rotation" | "scale" | "position" | "crop" | "volume";

interface PropDef<K extends KeyframeTrackKey> {
  prop: Prop;
  trackKey: K;
  label: string;
  sample(clip: Clip, frame: number): KeyframeValueMap[K];
}

const VISUAL_PROPS: PropDef<KeyframeTrackKey>[] = [
  {
    prop: "opacity",
    trackKey: "opacityTrack",
    label: "Opacity",
    sample: (clip, frame) => opacityAt(clip, frame) as never,
  },
  {
    prop: "rotation",
    trackKey: "rotationTrack",
    label: "Rotation",
    sample: (clip, frame) => rotationAt(clip, frame) as never,
  },
  {
    prop: "scale",
    trackKey: "scaleTrack",
    label: "Scale",
    sample: (clip, frame) => {
      const s = sizeAt(clip, frame);
      return { a: s.width, b: s.height } as never;
    },
  },
  {
    prop: "position",
    trackKey: "positionTrack",
    label: "Position",
    sample: (clip, frame) => {
      const p = topLeftAt(clip, frame);
      return { a: p.x, b: p.y } as never;
    },
  },
  {
    prop: "crop",
    trackKey: "cropTrack",
    label: "Crop",
    sample: (clip, frame) => cropAt(clip, frame) as never,
  },
];

const VOLUME_PROP: PropDef<"volumeTrack"> = {
  prop: "volume",
  trackKey: "volumeTrack",
  label: "Volume",
  sample: () => 0 as never,
};

const VISUAL_TYPES = new Set(["video", "image", "text", "lottie"]);
const AUDIO_TYPES = new Set(["audio", "video"]);

export interface KeyframeLanesProps {
  clip: Clip;
  playhead: number;
  store: EditorStore;
}

export function KeyframeLanes({ clip, playhead, store }: KeyframeLanesProps) {
  const isVisual = VISUAL_TYPES.has(clip.mediaType);
  const hasAudio = AUDIO_TYPES.has(clip.mediaType);

  const props: PropDef<KeyframeTrackKey>[] = [
    ...(isVisual ? VISUAL_PROPS : []),
    ...(hasAudio ? [VOLUME_PROP as PropDef<KeyframeTrackKey>] : []),
  ];

  if (props.length === 0) return null;

  return (
    <div data-testid="inspector-section-Keyframes" style={{ borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`, padding: `${theme.spacing.xs} ${theme.spacing.sm}` }}>
      <div
        style={{
          fontSize: theme.fontSize.micro,
          fontWeight: theme.fontWeight.semibold,
          color: theme.text.tertiary,
          letterSpacing: theme.letterSpacing.wide,
          textTransform: "uppercase",
          marginBottom: theme.spacing.xxs,
        }}
      >
        Keyframes
      </div>
      {props.map((def) => (
        <KeyframeLane key={def.prop} clip={clip} playhead={playhead} store={store} def={def} />
      ))}
    </div>
  );
}

interface KeyframeLaneProps {
  clip: Clip;
  playhead: number;
  store: EditorStore;
  def: PropDef<KeyframeTrackKey>;
}

function KeyframeLane({ clip, playhead, store, def }: KeyframeLaneProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startFrame: number;
    currentFrame: number;
    value: KeyframeValueMap[KeyframeTrackKey];
    coalesceKey: string;
  } | null>(null);

  const offset = playhead - clip.startFrame;
  const dur = clip.durationFrames;

  const track = clip[def.trackKey as keyof Clip] as
    | { keyframes: Array<{ frame: number; value: unknown; interpolationOut: string }> }
    | undefined;

  const keyframes = track?.keyframes ?? [];
  const hasKfAtOffset = keyframes.some((k) => k.frame === offset);
  const withinClip = offset >= 0 && offset <= dur;

  const handleToggle = useCallback(() => {
    if (!withinClip) return;
    if (hasKfAtOffset) {
      store.dispatch(
        removeKeyframeCommand(clip.id, def.trackKey, offset, `kf-${clip.id}-${def.prop}`),
      );
    } else {
      const value = def.sample(clip, playhead);
      store.dispatch(
        setKeyframeCommand(
          clip.id,
          def.trackKey,
          offset,
          value,
          "linear",
          `kf-${clip.id}-${def.prop}`,
        ),
      );
    }
  }, [clip, def, offset, hasKfAtOffset, withinClip, playhead, store]);

  const xForKfFrame = (kfFrame: number, laneWidth: number): number => {
    if (dur === 0) return 0;
    return (kfFrame / dur) * laneWidth;
  };

  const frameAtLaneX = (localX: number, laneWidth: number): number => {
    if (laneWidth === 0 || dur === 0) return 0;
    return Math.max(0, Math.min(dur, Math.round((localX / laneWidth) * dur)));
  };

  const handleLanePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const lane = laneRef.current;
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const laneWidth = rect.width;

      // find if we hit a keyframe diamond (within DIAMOND_HALF*2 px)
      let hitKf: { frame: number; value: unknown } | null = null;
      for (const kf of keyframes) {
        const kfX = xForKfFrame(kf.frame, laneWidth);
        if (Math.abs(localX - kfX) <= DIAMOND_PX) {
          hitKf = kf as { frame: number; value: unknown };
          break;
        }
      }

      if (hitKf) {
        e.preventDefault();
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        dragRef.current = {
          pointerId: e.pointerId,
          startFrame: hitKf.frame,
          currentFrame: hitKf.frame,
          value: hitKf.value as KeyframeValueMap[KeyframeTrackKey],
          coalesceKey: `kfmove-${clip.id}-${def.prop}`,
        };
      } else {
        // click on empty lane → seek
        const seekFrame = clip.startFrame + frameAtLaneX(localX, laneWidth);
        store.setPlayhead(seekFrame);
      }
    },
    [clip, def, keyframes, store],
  );

  const handleLanePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const lane = laneRef.current;
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const laneWidth = rect.width;
      const newFrame = frameAtLaneX(localX, laneWidth);
      if (newFrame === drag.currentFrame) return;

      const prevFrame = drag.currentFrame;
      drag.currentFrame = newFrame;

      // remove old, set new — both under same coalesceKey so whole drag = one undo
      store.dispatch(
        removeKeyframeCommand(clip.id, def.trackKey, prevFrame, drag.coalesceKey),
      );
      store.dispatch(
        setKeyframeCommand(
          clip.id,
          def.trackKey,
          newFrame,
          drag.value,
          "linear",
          drag.coalesceKey,
        ),
      );
    },
    [clip, def, store],
  );

  const handleLanePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Right-click a keyframe diamond to remove it (without having to park the playhead on it).
  const handleLaneContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const lane = laneRef.current;
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      for (const kf of keyframes) {
        if (Math.abs(localX - xForKfFrame(kf.frame, rect.width)) <= DIAMOND_PX) {
          e.preventDefault();
          store.dispatch(removeKeyframeCommand(clip.id, def.trackKey, kf.frame, `kf-${clip.id}-${def.prop}`));
          return;
        }
      }
    },
    [clip, def, keyframes, store],
  );

  // Playhead position ratio
  const playheadRatio = dur > 0 ? Math.max(0, Math.min(1, offset / dur)) : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xxs} 0`,
      }}
    >
      {/* Toggle button */}
      <button
        data-testid={`kf-toggle-${def.prop}`}
        onClick={handleToggle}
        title={hasKfAtOffset ? `Remove ${def.label} keyframe` : `Add ${def.label} keyframe`}
        style={{
          width: theme.size.kfToggle,
          height: theme.size.kfToggle,
          flexShrink: 0,
          background: hasKfAtOffset ? theme.accent.timecode : theme.bg.raised,
          border: `${theme.borderWidth.hairline} solid ${hasKfAtOffset ? theme.accent.timecode : theme.border.primary}`,
          borderRadius: theme.radius.xs,
          cursor: withinClip ? "pointer" : "not-allowed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: withinClip ? theme.opacity.opaque : theme.opacity.disabled,
        }}
      >
        {/* Diamond icon */}
        <svg width="8" height="8" viewBox="0 0 8 8">
          <polygon
            points="4,0 8,4 4,8 0,4"
            fill={hasKfAtOffset ? theme.bg.base : theme.text.muted}
          />
        </svg>
      </button>

      {/* Label */}
      <span
        style={{
          fontSize: theme.fontSize.xs,
          color: theme.text.secondary,
          minWidth: theme.size.kfLabel,
          flexShrink: 0,
        }}
      >
        {def.label}
      </span>

      {/* Mini lane */}
      <div
        ref={laneRef}
        data-testid={`kf-lane-${def.prop}`}
        onPointerDown={handleLanePointerDown}
        onPointerMove={handleLanePointerMove}
        onPointerUp={handleLanePointerUp}
        onPointerCancel={handleLanePointerUp}
        onContextMenu={handleLaneContextMenu}
        style={{
          position: "relative",
          flex: 1,
          height: theme.size.kfLane,
          background: theme.bg.raised,
          borderRadius: theme.radius.xs,
          border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
          overflow: "hidden",
          cursor: "pointer",
        }}
      >
        {/* Keyframe diamonds */}
        {keyframes.map((kf) => (
          <KfDiamond key={kf.frame} frame={kf.frame} dur={dur} />
        ))}

        {/* Playhead marker */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${playheadRatio * 100}%`,
            width: theme.borderWidth.thin,
            background: theme.accent.timecode,
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

function KfDiamond({ frame, dur }: { frame: number; dur: number }) {
  const ratio = dur > 0 ? frame / dur : 0;
  return (
    <div
      title="Drag to move · right-click to remove"
      style={{
        position: "absolute",
        top: "50%",
        left: `${ratio * 100}%`,
        transform: "translate(-50%, -50%) rotate(45deg)",
        width: theme.size.kfDiamond,
        height: theme.size.kfDiamond,
        background: theme.accent.timecode,
        cursor: "ew-resize",
        pointerEvents: "auto",
      }}
    />
  );
}
