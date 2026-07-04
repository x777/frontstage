import { useState, useRef, useEffect } from "react";
import type { ProjectSession, ConfirmDiscard, ProjectRef, FcpxmlTarget, FcpxmlVersion } from "@palmier/core";
import { theme } from "../theme/theme.js";
import type { RunProjectCommand } from "./Editor.js";
import type { ExportKind, FcpxmlExportOptions } from "./use-export-command.js";

// Swift parity (ExportView.swift:216-249 / FCPXMLExporter.swift) — "For" + "Version" pickers, shown
// only alongside the FCPXML export option; verbatim compatibility-note copy per version.
const FCPXML_TARGETS: { value: FcpxmlTarget; label: string }[] = [
  { value: "resolve", label: "DaVinci Resolve" },
  { value: "fcp", label: "Final Cut Pro" },
];
const FCPXML_VERSIONS: FcpxmlVersion[] = ["1.10", "1.11", "1.12", "1.13", "1.14"];
const FCPXML_COMPATIBILITY_NOTES: Record<FcpxmlVersion, string> = {
  "1.10": "DaVinci Resolve 18+, Final Cut Pro 10.6+",
  "1.11": "DaVinci Resolve 21+, Final Cut Pro 10.7+",
  "1.12": "DaVinci Resolve 21+, Final Cut Pro 10.8+",
  "1.13": "DaVinci Resolve 21+, Final Cut Pro 11+",
  "1.14": "DaVinci Resolve 21+, Final Cut Pro 12+",
};
const DEFAULT_FCPXML_TARGET: FcpxmlTarget = "resolve";
const DEFAULT_FCPXML_VERSION: FcpxmlVersion = "1.10";

export interface FileMenuProps {
  session: ProjectSession;
  confirmDiscard: ConfirmDiscard;
  runProjectCommand: RunProjectCommand;
  onExport?: (kind: ExportKind, fcpxmlOptions?: FcpxmlExportOptions) => void;
  // XMEML/FCPXML availability is separate from the video gateway — gates the two extra buttons.
  canExportXml?: boolean;
  // SRT/VTT (M14A T1): gated on the timeline having caption clips, not on canExportXml.
  canExportCaptions?: boolean;
}

export function FileMenu({ session, confirmDiscard, runProjectCommand, onExport, canExportXml, canExportCaptions }: FileMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentRefs, setRecentRefs] = useState<ProjectRef[]>([]);
  const [fcpxmlTarget, setFcpxmlTarget] = useState<FcpxmlTarget>(DEFAULT_FCPXML_TARGET);
  const [fcpxmlVersion, setFcpxmlVersion] = useState<FcpxmlVersion>(DEFAULT_FCPXML_VERSION);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load recent list whenever menu opens
  useEffect(() => {
    if (!menuOpen) return;
    session.listRecent()
      .then((refs) => setRecentRefs(refs ?? []))
      .catch(() => setRecentRefs([]));
  }, [menuOpen, session]);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  function handleNew() {
    setMenuOpen(false);
    runProjectCommand(() => session.newProject(confirmDiscard));
  }

  function handleOpen() {
    setMenuOpen(false);
    runProjectCommand(() => session.open(confirmDiscard));
  }

  function handleOpenRecent(ref: ProjectRef) {
    setMenuOpen(false);
    runProjectCommand(() => session.open(confirmDiscard, ref));
  }

  function handleSave() {
    setMenuOpen(false);
    runProjectCommand(() => session.save());
  }

  function handleSaveAs() {
    setMenuOpen(false);
    runProjectCommand(() => session.saveAs());
  }

  const topBtnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    color: theme.text.secondary,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    borderRadius: theme.radius.xs,
  };

  const menuStyle: React.CSSProperties = {
    position: "absolute",
    top: `calc(100% + ${theme.spacing.xxs})`,
    left: 0,
    background: theme.bg.raised,
    border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
    borderRadius: theme.radius.sm,
    boxShadow: theme.shadow.lg,
    minWidth: theme.size.menuMin,
    zIndex: theme.z.menu,
    display: "flex",
    flexDirection: "column",
    padding: `${theme.spacing.xxs} 0`,
  };

  const itemStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    color: theme.text.primary,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    padding: `${theme.spacing.xs} ${theme.spacing.md}`,
    textAlign: "left",
    width: "100%",
  };

  const sepStyle: React.CSSProperties = {
    height: theme.borderWidth.thin,
    background: theme.border.divider,
    margin: `${theme.spacing.xxs} 0`,
  };

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <button
        data-testid="file-menu"
        style={topBtnStyle}
        onClick={() => setMenuOpen((v) => !v)}
      >
        File
      </button>
      {menuOpen && (
        <div style={menuStyle}>
          <button data-testid="file-new" style={itemStyle} onClick={handleNew}>
            New
          </button>
          <button data-testid="file-open" style={itemStyle} onClick={handleOpen}>
            Open…
          </button>
          {recentRefs.length > 0 && (
            <>
              <div style={sepStyle} />
              <span
                style={{
                  ...itemStyle,
                  color: theme.text.tertiary,
                  cursor: "default",
                  fontSize: theme.fontSize.xs,
                }}
              >
                Open Recent
              </span>
              {recentRefs.map((ref, i) => (
                <button
                  key={ref.id}
                  data-testid={`file-recent-${i}`}
                  style={itemStyle}
                  onClick={() => handleOpenRecent(ref)}
                >
                  {ref.name}
                </button>
              ))}
            </>
          )}
          <div style={sepStyle} />
          <button data-testid="file-save" style={itemStyle} onClick={handleSave}>
            Save
          </button>
          <button data-testid="file-save-as" style={itemStyle} onClick={handleSaveAs}>
            Save As…
          </button>
          {onExport && (
            <>
              <div style={sepStyle} />
              <button
                data-testid="file-export-video"
                style={itemStyle}
                onClick={() => { setMenuOpen(false); onExport("video"); }}
              >
                Export Video (MP4)…
              </button>
              {canExportXml && (
                <>
                  <button
                    data-testid="file-export-fcpxml"
                    style={itemStyle}
                    onClick={() => {
                      setMenuOpen(false);
                      onExport("fcpxml", { target: fcpxmlTarget, version: fcpxmlVersion });
                    }}
                  >
                    Export FCPXML (Resolve/FCP)…
                  </button>
                  <div
                    data-testid="fcpxml-options"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: theme.spacing.xs,
                      padding: `${theme.spacing.xxs} ${theme.spacing.md}`,
                    }}
                  >
                    <span style={{ fontSize: theme.fontSize.xxs, color: theme.text.tertiary }}>For</span>
                    <select
                      data-testid="fcpxml-target"
                      value={fcpxmlTarget}
                      onChange={(e) => setFcpxmlTarget(e.target.value as FcpxmlTarget)}
                      style={{
                        background: theme.bg.surface,
                        border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
                        borderRadius: theme.radius.xs,
                        color: theme.text.secondary,
                        fontSize: theme.fontSize.xxs,
                        padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                      }}
                    >
                      {FCPXML_TARGETS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: theme.fontSize.xxs, color: theme.text.tertiary }}>Version</span>
                    <select
                      data-testid="fcpxml-version"
                      value={fcpxmlVersion}
                      onChange={(e) => setFcpxmlVersion(e.target.value as FcpxmlVersion)}
                      style={{
                        background: theme.bg.surface,
                        border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
                        borderRadius: theme.radius.xs,
                        color: theme.text.secondary,
                        fontSize: theme.fontSize.xxs,
                        padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                      }}
                    >
                      {FCPXML_VERSIONS.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <span
                      data-testid="fcpxml-compat-note"
                      style={{ fontSize: theme.fontSize.xxs, color: theme.text.tertiary, whiteSpace: "nowrap" }}
                    >
                      {FCPXML_COMPATIBILITY_NOTES[fcpxmlVersion]}
                    </span>
                  </div>
                  <button
                    data-testid="file-export-xmeml"
                    style={itemStyle}
                    onClick={() => { setMenuOpen(false); onExport("xmeml"); }}
                  >
                    Export XMEML (Premiere)…
                  </button>
                </>
              )}
              {canExportCaptions && (
                <>
                  <button
                    data-testid="file-export-srt"
                    style={itemStyle}
                    onClick={() => { setMenuOpen(false); onExport("srt"); }}
                  >
                    Captions (SRT)…
                  </button>
                  <button
                    data-testid="file-export-vtt"
                    style={itemStyle}
                    onClick={() => { setMenuOpen(false); onExport("vtt"); }}
                  >
                    Captions (VTT)…
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
