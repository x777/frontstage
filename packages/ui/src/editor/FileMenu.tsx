import { useState, useRef, useEffect } from "react";
import type { ProjectSession, ConfirmDiscard, ProjectRef } from "@palmier/core";
import { theme } from "../theme/theme.js";

export interface FileMenuProps {
  session: ProjectSession;
  confirmDiscard: ConfirmDiscard;
}

export function FileMenu({ session, confirmDiscard }: FileMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentRefs, setRecentRefs] = useState<ProjectRef[]>([]);
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

  async function handleNew() {
    setMenuOpen(false);
    await session.newProject(confirmDiscard);
  }

  async function handleOpen() {
    setMenuOpen(false);
    await session.open(confirmDiscard);
  }

  async function handleOpenRecent(ref: ProjectRef) {
    setMenuOpen(false);
    await session.open(confirmDiscard, ref);
  }

  async function handleSave() {
    setMenuOpen(false);
    await session.save();
  }

  async function handleSaveAs() {
    setMenuOpen(false);
    await session.saveAs();
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
        </div>
      )}
    </div>
  );
}
