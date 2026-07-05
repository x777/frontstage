import { useState, useRef, useEffect } from "react";
import type { ProjectSession, ConfirmDiscard, ProjectRef, FcpxmlTarget, FcpxmlVersion } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { Button, MenuList } from "../primitives/index.js";
import type { MenuListItem } from "../primitives/index.js";
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

  const selectStyle: React.CSSProperties = {
    background: theme.bg.surface,
    border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
    borderRadius: theme.radius.xs,
    color: theme.text.secondary,
    fontSize: theme.fontSize.xxs,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
  };

  // Swift's real File menu is a native NSMenu (MainMenu.swift) — no icons on any item, so none are
  // added here. Recent list + per-format export rows have no NSMenu analog (that command surface is
  // this port's own; kept verbatim) — only the MenuList chrome + separator placement is restyled.
  const items: MenuListItem[] = [
    { id: "new", label: "New", testid: "file-new" },
    { id: "open", label: "Open…", testid: "file-open" },
  ];
  if (recentRefs.length > 0) {
    items.push({ id: "recent-header", label: "Open Recent", header: true, separatorBefore: true });
    recentRefs.forEach((ref, i) => {
      items.push({ id: `recent-${i}`, label: ref.name, testid: `file-recent-${i}` });
    });
  }
  items.push(
    { id: "save", label: "Save", testid: "file-save", separatorBefore: true },
    { id: "save-as", label: "Save As…", testid: "file-save-as" },
  );
  if (onExport) {
    items.push({ id: "export-video", label: "Export Video (MP4)…", testid: "file-export-video", separatorBefore: true });
    if (canExportXml) {
      items.push({ id: "export-fcpxml", label: "Export FCPXML (Resolve/FCP)…", testid: "file-export-fcpxml" });
      items.push({
        id: "fcpxml-options",
        label: "",
        content: (
          <div
            data-testid="fcpxml-options"
            style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs, padding: `${theme.spacing.xxs} ${theme.spacing.sm}` }}
          >
            <span style={{ fontSize: theme.fontSize.xxs, color: theme.text.tertiary }}>For</span>
            <select
              data-testid="fcpxml-target"
              value={fcpxmlTarget}
              onChange={(e) => setFcpxmlTarget(e.target.value as FcpxmlTarget)}
              style={selectStyle}
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
              style={selectStyle}
            >
              {FCPXML_VERSIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <span data-testid="fcpxml-compat-note" style={{ fontSize: theme.fontSize.xxs, color: theme.text.tertiary, whiteSpace: "nowrap" }}>
              {FCPXML_COMPATIBILITY_NOTES[fcpxmlVersion]}
            </span>
          </div>
        ),
      });
      items.push({ id: "export-xmeml", label: "Export XMEML (Premiere)…", testid: "file-export-xmeml" });
    }
    if (canExportCaptions) {
      items.push({ id: "export-srt", label: "Captions (SRT)…", testid: "file-export-srt" });
      items.push({ id: "export-vtt", label: "Captions (VTT)…", testid: "file-export-vtt" });
    }
  }

  function handleSelect(id: string) {
    if (id === "new") return handleNew();
    if (id === "open") return handleOpen();
    if (id.startsWith("recent-")) {
      const i = Number(id.slice("recent-".length));
      const ref = recentRefs[i];
      if (ref) handleOpenRecent(ref);
      return;
    }
    if (id === "save") return handleSave();
    if (id === "save-as") return handleSaveAs();
    if (id === "export-video") { setMenuOpen(false); onExport?.("video"); return; }
    if (id === "export-fcpxml") { setMenuOpen(false); onExport?.("fcpxml", { target: fcpxmlTarget, version: fcpxmlVersion }); return; }
    if (id === "export-xmeml") { setMenuOpen(false); onExport?.("xmeml"); return; }
    if (id === "export-srt") { setMenuOpen(false); onExport?.("srt"); return; }
    if (id === "export-vtt") { setMenuOpen(false); onExport?.("vtt"); return; }
  }

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <Button
        testid="file-menu"
        onClick={() => setMenuOpen((v) => !v)}
      >
        File
      </Button>
      {menuOpen && (
        <div style={{ position: "absolute", top: `calc(100% + ${theme.spacing.xxs})`, left: 0, zIndex: theme.z.menu }}>
          <MenuList items={items} onSelect={handleSelect} />
        </div>
      )}
    </div>
  );
}
