import { useState, useRef, useEffect, useCallback } from "react";
import type { ProjectSession, ConfirmDiscard, ProjectRef } from "@palmier/core";
import { theme } from "../theme/theme.js";

export interface FileMenuProps {
  session: ProjectSession;
  isDirty: boolean;
}

interface DiscardDialogState {
  resolve: (v: boolean) => void;
}

export function FileMenu({ session, isDirty }: FileMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentRefs, setRecentRefs] = useState<ProjectRef[]>([]);
  const [dialog, setDialog] = useState<DiscardDialogState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load recent list whenever menu opens
  useEffect(() => {
    if (!menuOpen) return;
    // Access gateway via public API — listRecent on session's gateway
    (session as unknown as { gateway: { listRecent?(): Promise<ProjectRef[]> } })
      .gateway?.listRecent?.()
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

  const askDiscard = useCallback((): Promise<boolean> => {
    if (!isDirty) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setDialog({ resolve });
    });
  }, [isDirty]);

  function closeDialog(result: boolean) {
    dialog?.resolve(result);
    setDialog(null);
  }

  const confirmDiscard: ConfirmDiscard = askDiscard;

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

  async function handleDiscardSave() {
    await session.save();
    closeDialog(true);
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
    top: "calc(100% + 4px)",
    left: 0,
    background: theme.bg.raised,
    border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
    borderRadius: theme.radius.sm,
    boxShadow: theme.shadow.lg,
    minWidth: 160,
    zIndex: 9000,
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

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
  };

  const dialogStyle: React.CSSProperties = {
    background: theme.bg.raised,
    border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    minWidth: 280,
    boxShadow: theme.shadow.lg,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
  };

  const btnRowStyle: React.CSSProperties = {
    display: "flex",
    gap: theme.spacing.xs,
    justifyContent: "flex-end",
  };

  const dialogBtnStyle: React.CSSProperties = {
    background: "none",
    border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
    borderRadius: theme.radius.xs,
    color: theme.text.primary,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  };

  return (
    <>
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

      {dialog && (
        <div data-testid="discard-dialog" style={overlayStyle}>
          <div style={dialogStyle}>
            <span style={{ fontSize: theme.fontSize.sm, color: theme.text.primary }}>
              You have unsaved changes. Discard them?
            </span>
            <div style={btnRowStyle}>
              <button
                data-testid="discard-cancel"
                style={dialogBtnStyle}
                onClick={() => closeDialog(false)}
              >
                Cancel
              </button>
              <button
                data-testid="discard-dont-save"
                style={dialogBtnStyle}
                onClick={() => closeDialog(true)}
              >
                Don&apos;t Save
              </button>
              <button
                data-testid="discard-save"
                style={{ ...dialogBtnStyle, background: theme.accent.primary, border: "none", color: "#fff" }}
                onClick={handleDiscardSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
