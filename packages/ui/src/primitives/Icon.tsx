export type IconName =
  | "folder"
  | "captions"
  | "plus"
  | "sparkles"
  | "search"
  | "ellipsis"
  | "grid"
  | "list"
  | "x"
  | "chevron-right"
  | "chevron-down"
  | "play"
  | "pause"
  | "step-back"
  | "step-forward"
  | "skip-to-start"
  | "skip-to-end"
  | "eye"
  | "eye-off"
  | "lock"
  | "lock-open"
  | "volume"
  | "volume-off"
  | "grip"
  | "diamond"
  | "diamond-filled"
  | "book"
  | "send"
  | "paperplane"
  | "image"
  | "trash"
  | "file"
  | "refresh"
  | "alert-triangle"
  | "history"
  | "paintpalette"
  | "aspectratio"
  | "ruler";

// Hand-drawn line glyphs — the SF Symbols stand-in for cross-platform. New panels ADD names
// here rather than inlining SVGs.
const PATHS: Record<IconName, React.ReactNode> = {
  folder: <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  captions: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <line x1="7" y1="14" x2="10" y2="14" />
      <line x1="13" y1="14" x2="17" y2="14" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" />
      <path d="M18 2l0.7 1.9 1.9 0.7-1.9 0.7-0.7 1.9-0.7-1.9-1.9-0.7 1.9-0.7z" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <line x1="14.5" y1="14.5" x2="20" y2="20" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  list: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </>
  ),
  x: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  play: <path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none" />,
  // "pause.fill" — filled bars, matching play's fill treatment (PreviewContainerView.transportButton).
  pause: (
    <>
      <rect x="6" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  // "backward.frame.fill" — single frame-step, distinct from a double-triangle skip-to-start.
  "step-back": (
    <>
      <rect x="4" y="5.5" width="2.4" height="13" rx="1" fill="currentColor" stroke="none" />
      <path d="M19 5.5v13l-11-6.5z" fill="currentColor" stroke="none" />
    </>
  ),
  // "forward.frame.fill" — mirror of step-back.
  "step-forward": (
    <>
      <path d="M5 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
      <rect x="17.6" y="5.5" width="2.4" height="13" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  // "backward.end.fill" — double left-pointing chevron with the boundary bar on the left.
  "skip-to-start": (
    <>
      <rect x="3" y="5.5" width="2.4" height="13" rx="1" fill="currentColor" stroke="none" />
      <path d="M13 5.5v13l-7-6.5z" fill="currentColor" stroke="none" />
      <path d="M20 5.5v13l-7-6.5z" fill="currentColor" stroke="none" />
    </>
  ),
  // "forward.end.fill" — mirror of skip-to-start, bar on the right.
  "skip-to-end": (
    <>
      <path d="M4 5.5v13l7-6.5z" fill="currentColor" stroke="none" />
      <path d="M11 5.5v13l7-6.5z" fill="currentColor" stroke="none" />
      <rect x="18.6" y="5.5" width="2.4" height="13" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M4 4l16 16" />
      <path d="M6.7 7.3A15 15 0 0 0 2 12s3.8 6 10 6c1.1 0 2.1-.2 3-.5M9.5 5.6c.8-.4 1.6-.6 2.5-.6 6.2 0 10 7 10 7a15.9 15.9 0 0 1-3.4 4.1" />
      <path d="M14.5 14.5a3 3 0 0 1-4-4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  "lock-open": (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a9 9 0 0 1 0 12" />
    </>
  ),
  "volume-off": (
    <>
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path d="M22 9l-6 6M16 9l6 6" />
    </>
  ),
  grip: (
    <>
      <line x1="6" y1="8" x2="18" y2="8" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="6" y1="16" x2="18" y2="16" />
    </>
  ),
  // "diamond" SF Symbol — hollow ring built from fill geometry (evenodd), not a stroked outline.
  // Outer ring fills the viewBox (matches diamond-filled) so a size=N render is ~N px.
  "diamond": (
    <path
      fillRule="evenodd"
      d="M12 1L23 12L12 23L1 12Z M12 6L18 12L12 18L6 12Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  // "diamond.fill" SF Symbol — solid, matching play/pause's filled-shape treatment. Fills the
  // viewBox (was 3,21 inset, ~75% of size) so a size=N render is ~N px, matching Swift.
  "diamond-filled": <polygon points="12,1 23,12 12,23 1,12" fill="currentColor" stroke="none" />,
  // "book.closed" — ViewSkillsButton.swift. Cover outline with a spine line near the leading edge.
  book: (
    <>
      <path d="M4.5 5a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v14.5a1 1 0 0 1-1 1H7A2.5 2.5 0 0 0 4.5 22z" />
      <line x1="8" y1="3" x2="8" y2="19.5" />
    </>
  ),
  // "arrow.up" — the composer's send affordance (AgentInputBox.sendStopButton).
  send: (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  // "paperplane" — the Agent settings tab (SettingsTab.agent.systemImage).
  paperplane: (
    <>
      <path d="M21 3L10.5 13.5" />
      <path d="M21 3l-6.5 18-4-8.5-8.5-4z" />
    </>
  ),
  // "photo" — GenerationView's refCard thumbnail fallback (Rectangle().fill(.quaternary) + sfSymbol).
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5-4 4-3-3-6 6" />
    </>
  ),
  // "trash" — SkillIconButton(delete)/AgentPane's remove-key trash button.
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  // "doc.text" — SkillRow's leading document glyph (Settings/SkillsPane.swift).
  file: (
    <>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </>
  ),
  // "arrow.clockwise" — SkillIconButton(refresh catalog).
  refresh: (
    <>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.6" />
      <path d="M4 4v4.6h4.6" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.4" />
      <path d="M20 20v-4.6h-4.6" />
    </>
  ),
  // "exclamationmark.triangle.fill" — AssetThumbnailView.failedThumbnail's error glyph. Swift's is
  // filled; kept as a stroked outline to match this set's line-glyph house style.
  "alert-triangle": (
    <>
      <path d="M12 3.5l9.5 16.5H2.5z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // "clock.arrow.circlepath" — ProjectActivityButton's toggle icon.
  history: (
    <>
      <path d="M12 4a8 8 0 1 0 8 8" />
      <path d="M20 3v5h-5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  // "paintpalette" — MatteSheet.swift row(icon:) Color row. Thumb-holed palette blob + 3 paint dabs.
  paintpalette: (
    <>
      <path d="M12 3C6.5 3 2 6.9 2 12c0 3.3 2.2 5 4.6 5H9a1.6 1.6 0 0 1 1.6 1.6c0 .8-.4 1.2-.4 1.9 0 .9.8 1.5 1.8 1.5 5.5 0 9-4.5 9-10S17.5 3 12 3z" />
      <circle cx="7.5" cy="10.8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8.2" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10.8" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  // "aspectratio" — MatteSheet.swift row(icon:) Aspect row. Frame corners around a rectangle.
  aspectratio: (
    <>
      <path d="M3 8V5a2 2 0 0 1 2-2h3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </>
  ),
  // "ruler" — MatteSheet.swift row(icon:) Size row. Diagonal ruler band with cross ticks.
  ruler: (
    <>
      <path d="M4.6 15.4L15.4 4.6a1.5 1.5 0 0 1 2.1 0l1.9 1.9a1.5 1.5 0 0 1 0 2.1L8.6 19.4a1.5 1.5 0 0 1-2.1 0l-1.9-1.9a1.5 1.5 0 0 1 0-2.1z" />
      <line x1="7.5" y1="12.5" x2="9.3" y2="14.3" />
      <line x1="10.6" y1="9.4" x2="12" y2="10.8" />
      <line x1="13.7" y1="6.3" x2="15.5" y2="8.1" />
    </>
  ),
};

export function Icon(props: { name: IconName; size?: number | string; testid?: string }) {
  const { name, size = 24, testid } = props;
  return (
    <svg
      data-testid={testid}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
