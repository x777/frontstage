import { useEffect, useRef, useState } from "react";
import type { GenerationLogEntry } from "@palmier/core";
import type { GenModelKind } from "@palmier/ai";
import { genModel, formatCredits } from "@palmier/ai";
import { theme } from "../theme/theme.js";

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;

// "just now" / "Nm ago" / "Nh ago" / "Nd ago" — deterministic `now` for tests.
export function relativeTime(iso: string | null, now: Date): string {
  if (iso === null) return "—";
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < MINUTE_S) return "just now";
  if (seconds < HOUR_S) return `${Math.floor(seconds / MINUTE_S)}m ago`;
  if (seconds < DAY_S) return `${Math.floor(seconds / HOUR_S)}h ago`;
  return `${Math.floor(seconds / DAY_S)}d ago`;
}

const KIND_GLYPH: Record<GenModelKind, string> = { video: "V", image: "I", audio: "A", upscale: "U", transcribe: "T" };

function kindGlyph(modelId: string): string {
  const kind = genModel(modelId)?.kind;
  return kind ? KIND_GLYPH[kind] : "?";
}

function modelDisplayName(modelId: string): string {
  return genModel(modelId)?.displayName ?? modelId;
}

function totalCredits(entries: GenerationLogEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.costCredits ?? 0), 0);
}

// ISO 8601 strings sort lexically = chronologically; null (never-finalized) entries sort last.
function sortedNewestFirst(entries: GenerationLogEntry[]): GenerationLogEntry[] {
  return [...entries].sort((a, b) => {
    if (a.createdAt === null) return b.createdAt === null ? 0 : 1;
    if (b.createdAt === null) return -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export interface ProjectActivityViewProps {
  entries: GenerationLogEntry[];
  now?: Date;
  onClose?: () => void;
}

export function ProjectActivityView({ entries, now = new Date(), onClose }: ProjectActivityViewProps) {
  const sorted = sortedNewestFirst(entries);
  const total = totalCredits(entries);

  return (
    <div
      data-testid="project-activity"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.sm,
        minWidth: theme.size.settingsPanelMin,
        padding: theme.spacing.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.text.primary }}>
          Activity
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.sm }}>
          {entries.length > 0 && (
            <span
              data-testid="activity-total"
              style={{ fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.medium, color: theme.text.tertiary }}
            >
              {formatCredits(total)}
            </span>
          )}
          {onClose && (
            <button
              data-testid="activity-close"
              onClick={onClose}
              aria-label="Close"
              style={{ background: "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.fontSize.md, padding: 0, lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div data-testid="activity-empty" style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, padding: `${theme.spacing.sm} 0` }}>
          No generations yet.
        </div>
      ) : (
        <div
          data-testid="activity-list"
          style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs, maxHeight: theme.size.activityMax, overflowY: "auto" }}
        >
          {sorted.map((entry) => (
            <div
              key={entry.id}
              data-testid="activity-row"
              style={{ display: "flex", alignItems: "center", gap: theme.spacing.sm, padding: `${theme.spacing.xs} 0` }}
            >
              <span style={{ fontSize: theme.fontSize.xs, color: theme.text.tertiary, width: theme.spacing.md, textAlign: "center" }}>
                {kindGlyph(entry.model)}
              </span>
              <span style={{ fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.medium, color: theme.text.secondary, width: theme.size.activityCost }}>
                {entry.costCredits === null ? "—" : formatCredits(entry.costCredits)}
              </span>
              <span
                style={{ flex: 1, fontSize: theme.fontSize.xs, color: theme.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={modelDisplayName(entry.model)}
              >
                {modelDisplayName(entry.model)}
              </span>
              <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, whiteSpace: "nowrap" }}>
                {relativeTime(entry.createdAt, now)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ProjectActivityButtonProps {
  getGenerationLog: () => GenerationLogEntry[];
}

// Reads the log fresh on open — the log only grows on finalize, so no live subscription is needed.
export function ProjectActivityButton({ getGenerationLog }: ProjectActivityButtonProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<GenerationLogEntry[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setEntries(getGenerationLog());
  }, [open, getGenerationLog]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const total = totalCredits(getGenerationLog());

  return (
    <div style={{ position: "relative" }} ref={rootRef}>
      <button
        data-testid="project-activity-toggle"
        onClick={() => setOpen((v) => !v)}
        title={`Project Activity · ${formatCredits(total)} used`}
        style={{
          background: open ? theme.accent.primary : "none",
          border: `${theme.borderWidth.thin} solid ${open ? theme.accent.primary : theme.border.subtle}`,
          borderRadius: theme.radius.xs,
          color: open ? theme.text.onAccent : theme.text.secondary,
          cursor: "pointer",
          fontSize: theme.fontSize.xs,
          padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
          lineHeight: 1,
        }}
      >
        ⏱
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: `calc(100% + ${theme.spacing.xxs})`,
            right: 0,
            background: theme.bg.raised,
            border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
            borderRadius: theme.radius.sm,
            boxShadow: theme.shadow.lg,
            zIndex: theme.z.menu,
          }}
        >
          <ProjectActivityView entries={entries} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
