import { useEffect, useRef, useState } from "react";
import type { Skill, SkillCatalogEntry } from "@palmier/ai";
import { SkillStore, SkillCatalog } from "@palmier/ai";
import { theme } from "../theme/theme.js";

export interface SkillsPaneProps {
  store: SkillStore;
  catalog: SkillCatalog;
}

const COMMUNITY_URL = "https://github.com/palmier-io/palmier-skills";

const EXTERNAL_AGENTS: { id: "claude" | "codex" | "cursor"; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
];

type CommunityState = "upToDate" | "update" | "modified";

interface CopyToast {
  agentLabel: string;
  path: string;
}

type CommunityItem =
  | { kind: "installed"; id: string; name: string; skill: Skill }
  | { kind: "available"; id: string; name: string; entry: SkillCatalogEntry };

function matches(name: string, description: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q) || description.toLowerCase().includes(q);
}

function Spinner() {
  return (
    <div
      data-testid="skills-spinner"
      style={{
        width: theme.size.skillsSpinner,
        height: theme.size.skillsSpinner,
        border: `${theme.borderWidth.medium} solid ${theme.border.subtle}`,
        borderTopColor: theme.text.secondary,
        borderRadius: "50%",
        animation: "skills-spin 0.6s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

export function SkillsPane({ store, catalog }: SkillsPaneProps) {
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const [entries, setEntries] = useState<SkillCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [originalDraft, setOriginalDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameDraft, setRenameDraft] = useState("");
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [toast, setToast] = useState<CopyToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refreshCatalog() {
    try {
      const fresh = await catalog.refresh();
      setEntries(fresh);
      setCatalogError(null);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    let alive = true;
    void store.reload().then(() => { if (alive) bump(); });
    void catalog.loadCached().then((cached) => { if (alive) setEntries(cached); });
    void refreshCatalog();
    return () => { alive = false; };
    // Runs once per mount (mirrors Swift's onAppear reload + catalog refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, catalog]);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const filtered = store.skills.filter((s) => matches(s.name, s.description, query));
  const mySkills = filtered.filter((s) => store.installedSha(s.id) === undefined);
  const communitySkills = filtered.filter((s) => store.installedSha(s.id) !== undefined);
  const localIds = new Set(store.skills.map((s) => s.id));
  const availableEntries = entries.filter((e) => !localIds.has(e.id) && matches(e.name, e.description, query));

  const communityItems: CommunityItem[] = [
    ...communitySkills.map((s): CommunityItem => ({ kind: "installed", id: s.id, name: s.name, skill: s })),
    ...availableEntries.map((e): CommunityItem => ({ kind: "available", id: e.id, name: e.name, entry: e })),
  ].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const selected = filtered.find((s) => s.id === selectedId) ?? filtered[0];

  function communityState(id: string): CommunityState {
    const ledger = store.installedSha(id);
    if (store.localSha(id) !== ledger) return "modified";
    const entry = entries.find((e) => e.id === id);
    if (entry && entry.sha !== ledger) return "update";
    return "upToDate";
  }

  function provenanceText(id: string): string {
    const ledgerSha = store.installedSha(id);
    if (ledgerSha === undefined) return "Local skill";
    const state = communityState(id);
    if (state === "modified") return "Community · modified locally";
    if (state === "update") return "Community · update available";
    return `Community · v${ledgerSha}`;
  }

  async function commitDraftIfDirty() {
    if (!editingId) return;
    if (draft === originalDraft) return;
    await store.save(editingId, draft);
    setOriginalDraft(draft);
    bump();
  }

  async function commitRename() {
    if (!renamingId) return;
    const id = renamingId;
    const value = renameDraft.trim();
    setRenamingId(undefined);
    if (!value) return;
    await store.rename(id, value);
    bump();
  }

  // Commits any pending rename/draft edit before moving selection elsewhere — mirrors Swift's
  // onChange(of: selection), which fires regardless of what caused the selection to change
  // (a row click, a fresh install, or a new skill).
  async function switchSelection(id: string | undefined) {
    await commitDraftIfDirty();
    await commitRename();
    setEditing(false);
    setEditingId(undefined);
    setSelectedId(id);
  }

  async function handleSelectRow(id: string) {
    if (id === selected?.id) return;
    await switchSelection(id);
  }

  async function handleInstall(entry: SkillCatalogEntry) {
    setInstalling((prev) => new Set(prev).add(entry.id));
    try {
      const bodyText = await catalog.skillText(entry);
      await store.install(entry, bodyText);
      bump();
      await switchSelection(entry.id);
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  async function handleUpdate(entry: SkillCatalogEntry) {
    const bodyText = await catalog.skillText(entry);
    await store.install(entry, bodyText);
    bump();
  }

  async function handleNew() {
    await commitDraftIfDirty();
    await commitRename();
    const id = await store.newSkill();
    bump();
    setEditing(false);
    setEditingId(undefined);
    setSelectedId(id);
  }

  async function handleDelete(skill: Skill) {
    const ok = window.confirm(`Delete "${skill.name}"? This permanently removes ${skill.id}/SKILL.md.`);
    if (!ok) return;
    await store.delete(skill.id);
    bump();
    setEditing(false);
    setEditingId(undefined);
    setSelectedId(store.skills[0]?.id);
  }

  async function handleEnterEdit(skill: Skill) {
    await commitRename();
    if (editingId !== skill.id) {
      const raw = (await store.readRaw(skill.id)) ?? "";
      setDraft(raw);
      setOriginalDraft(raw);
      setEditingId(skill.id);
    }
    setEditing(true);
  }

  async function handleSave() {
    if (!editingId) return;
    await store.save(editingId, draft);
    setOriginalDraft(draft);
    bump();
  }

  function beginRename(skill: Skill) {
    if (editing) return;
    setRenamingId(skill.id);
    setRenameDraft(skill.name);
  }

  async function handleCopyToAgent(skill: Skill, agentId: "claude" | "codex" | "cursor", agentLabel: string) {
    const result = await store.exportToAgent(skill.id, agentId);
    setCopyMenuOpen(false);
    if (!result) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ agentLabel, path: result.path });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  const inputStyle: React.CSSProperties = {
    background: theme.bg.surface,
    border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
    borderRadius: theme.radius.xs,
    color: theme.text.primary,
    fontSize: theme.fontSize.sm,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    outline: "none",
    fontFamily: "inherit",
  };

  const iconBtnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    color: theme.text.secondary,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    lineHeight: 1,
  };

  return (
    <div data-testid="skills-pane" style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
      <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
        <span data-testid="skills-header-copy" style={{ fontSize: theme.fontSize.xs, color: theme.text.tertiary }}>
          These skills are available to the in-app agent once installed. For Claude/Codex/Cursor, add them to their respective directories.
        </span>
        <a
          data-testid="skills-community-link"
          href={COMMUNITY_URL}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: theme.fontSize.xs, color: theme.accent.primary }}
        >
          Check out community skills ↗
        </a>
      </div>

      <div
        style={{
          display: "flex",
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.md,
          height: theme.size.skillsPaneHeight,
          position: "relative",
        }}
      >
        {toast && (
          <div
            data-testid="skills-copy-toast"
            style={{
              position: "absolute",
              top: theme.spacing.xs,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.sm,
              background: theme.bg.raised,
              border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
              borderRadius: theme.radius.md,
              boxShadow: theme.shadow.lg,
              padding: `${theme.spacing.xs} ${theme.spacing.md}`,
              maxWidth: theme.size.skillsToastMax,
              zIndex: theme.z.toast,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs, minWidth: 0 }}>
              <span style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.text.primary }}>
                Added to {toast.agentLabel}
              </span>
              <span
                style={{
                  fontSize: theme.fontSize.xxs,
                  color: theme.text.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {toast.path}
              </span>
            </div>
            {store.canReveal && (
              <button
                data-testid="skills-copy-toast-open"
                onClick={() => { if (selected) void store.revealSkill(selected.id); setToast(null); }}
                style={{ ...iconBtnStyle, fontWeight: theme.fontWeight.semibold, color: theme.accent.primary }}
              >
                Open
              </button>
            )}
          </div>
        )}

        {/* Left column: search + My Skills / Community */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: theme.size.skillsListWidth,
            flexShrink: 0,
            borderRight: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs, padding: theme.spacing.sm }}>
            <input
              data-testid="skills-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button data-testid="skills-new" title="New skill" onClick={handleNew} style={iconBtnStyle}>+</button>
            {store.canOpenRoot && (
              <button data-testid="skills-open-folder" title="Open skills folder" onClick={() => void store.openRoot()} style={iconBtnStyle}>
                Folder
              </button>
            )}
            <button data-testid="skills-refresh-catalog" title="Refresh catalog" onClick={() => void refreshCatalog()} style={iconBtnStyle}>
              ⟳
            </button>
          </div>

          <div style={{ overflowY: "auto", flex: 1, padding: `0 ${theme.spacing.xs}` }}>
            <div data-testid="skills-section-my" style={{ fontSize: theme.fontSize.xxs, fontWeight: theme.fontWeight.semibold, color: theme.text.muted, padding: `${theme.spacing.xs} ${theme.spacing.xs} ${theme.spacing.xxs}` }}>
              MY SKILLS · {mySkills.length}
            </div>
            {mySkills.length === 0 ? (
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, padding: `${theme.spacing.xxs} ${theme.spacing.sm}` }}>None</div>
            ) : (
              mySkills.map((s) => (
                <SkillRow key={s.id} skill={s} isSelected={selected?.id === s.id} onClick={() => void handleSelectRow(s.id)} />
              ))
            )}

            <div data-testid="skills-section-community" style={{ fontSize: theme.fontSize.xxs, fontWeight: theme.fontWeight.semibold, color: theme.text.muted, padding: `${theme.spacing.sm} ${theme.spacing.xs} ${theme.spacing.xxs}` }}>
              COMMUNITY · {communityItems.length}
            </div>
            {communityItems.length === 0 ? (
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, padding: `${theme.spacing.xxs} ${theme.spacing.sm}` }}>None</div>
            ) : (
              communityItems.map((item) =>
                item.kind === "installed" ? (
                  <SkillRow
                    key={item.id}
                    skill={item.skill}
                    isSelected={selected?.id === item.id}
                    badge={communityState(item.id) === "upToDate" ? undefined : communityState(item.id)}
                    onClick={() => void handleSelectRow(item.id)}
                  />
                ) : (
                  <div
                    key={item.id}
                    data-testid={`skills-available-${item.id}`}
                    title={item.entry.description}
                    style={{ display: "flex", alignItems: "center", gap: theme.spacing.sm, padding: `${theme.spacing.smMd} ${theme.spacing.sm}` }}
                  >
                    <span style={{ flex: 1, fontSize: theme.fontSize.sm, color: theme.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.entry.name}
                    </span>
                    {installing.has(item.id) ? (
                      <Spinner />
                    ) : (
                      <button
                        data-testid={`skills-install-${item.id}`}
                        onClick={() => void handleInstall(item.entry)}
                        style={{ ...iconBtnStyle, fontWeight: theme.fontWeight.semibold, color: theme.accent.primary }}
                      >
                        Install
                      </button>
                    )}
                  </div>
                ),
              )
            )}
            {catalogError && entries.length === 0 && (
              <div data-testid="skills-catalog-error" style={{ fontSize: theme.fontSize.xxs, color: theme.text.muted, padding: theme.spacing.sm }}>
                Catalog: {catalogError}
              </div>
            )}
          </div>
        </div>

        {/* Right column: detail */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {!selected ? (
            <div data-testid="skills-empty" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: theme.fontSize.sm, color: theme.text.tertiary }}>
              Select a skill.
            </div>
          ) : (
            <SkillDetail
              skill={selected}
              store={store}
              editing={editing}
              editingThisSkill={editingId === selected.id}
              draft={draft}
              originalDraft={originalDraft}
              renaming={renamingId === selected.id}
              renameDraft={renameDraft}
              copyMenuOpen={copyMenuOpen}
              communityState={store.installedSha(selected.id) !== undefined ? communityState(selected.id) : undefined}
              updateEntry={entries.find((e) => e.id === selected.id)}
              provenance={provenanceText(selected.id)}
              body={store.body(selected.id) ?? ""}
              onRenameStart={() => beginRename(selected)}
              onRenameChange={setRenameDraft}
              onRenameCommit={() => void commitRename()}
              onDraftChange={setDraft}
              onSave={() => void handleSave()}
              onEnterEdit={() => void handleEnterEdit(selected)}
              onEnterView={() => setEditing(false)}
              onUpdate={(entry) => void handleUpdate(entry)}
              onDelete={() => void handleDelete(selected)}
              onReveal={() => void store.revealSkill(selected.id)}
              onCopyMenuToggle={() => setCopyMenuOpen((v) => !v)}
              onCopyToAgent={(agentId, agentLabel) => void handleCopyToAgent(selected, agentId, agentLabel)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  isSelected,
  badge,
  onClick,
}: {
  skill: Skill;
  isSelected: boolean;
  badge?: CommunityState;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={`skills-row-${skill.id}`}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: theme.spacing.sm,
        background: isSelected ? theme.bg.surface : "none",
        border: "none",
        borderRadius: theme.radius.sm,
        color: theme.text.primary,
        cursor: "pointer",
        fontSize: theme.fontSize.sm,
        padding: `${theme.spacing.smMd} ${theme.spacing.sm}`,
        textAlign: "left",
      }}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.name}</span>
      {badge === "update" && (
        <span data-testid={`skills-badge-update-${skill.id}`} style={{ color: theme.accent.primary, fontSize: theme.fontSize.xs }}>↓</span>
      )}
      {badge === "modified" && (
        <span data-testid={`skills-badge-modified-${skill.id}`} style={{ color: theme.text.muted, fontSize: theme.fontSize.xxs }}>Modified</span>
      )}
    </button>
  );
}

interface SkillDetailProps {
  skill: Skill;
  store: SkillStore;
  editing: boolean;
  editingThisSkill: boolean;
  draft: string;
  originalDraft: string;
  renaming: boolean;
  renameDraft: string;
  copyMenuOpen: boolean;
  communityState: CommunityState | undefined;
  updateEntry: SkillCatalogEntry | undefined;
  provenance: string;
  body: string;
  onRenameStart: () => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onDraftChange: (v: string) => void;
  onSave: () => void;
  onEnterEdit: () => void;
  onEnterView: () => void;
  onUpdate: (entry: SkillCatalogEntry) => void;
  onDelete: () => void;
  onReveal: () => void;
  onCopyMenuToggle: () => void;
  onCopyToAgent: (agentId: "claude" | "codex" | "cursor", agentLabel: string) => void;
}

function SkillDetail(props: SkillDetailProps) {
  const {
    skill, store, editing, editingThisSkill, draft, originalDraft, renaming, renameDraft, copyMenuOpen,
    communityState, updateEntry, provenance, body,
    onRenameStart, onRenameChange, onRenameCommit, onDraftChange, onSave, onEnterEdit, onEnterView,
    onUpdate, onDelete, onReveal, onCopyMenuToggle, onCopyToAgent,
  } = props;

  const dirty = editing && editingThisSkill && draft !== originalDraft;
  const segBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? theme.bg.surface : "none",
    border: "none",
    borderRadius: theme.radius.xs,
    color: active ? theme.text.primary : theme.text.muted,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
  });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.md, padding: theme.spacing.sm, borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.subtle}` }}>
        {renaming ? (
          <input
            data-testid="skills-rename-input"
            autoFocus
            value={renameDraft}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onRenameCommit(); }}
            onBlur={onRenameCommit}
            style={{
              flex: 1,
              background: theme.bg.surface,
              border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
              borderRadius: theme.radius.xs,
              color: theme.text.primary,
              fontSize: theme.fontSize.lg,
              fontWeight: theme.fontWeight.semibold,
              padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <span
            data-testid="skills-title"
            title="Double-click to rename"
            onDoubleClick={onRenameStart}
            style={{ flex: 1, fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.semibold, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {skill.name}
          </span>
        )}

        {dirty && (
          <span data-testid="skills-edited" style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>Edited</span>
        )}

        {editing && (
          <button
            data-testid="skills-save"
            disabled={!dirty}
            onClick={onSave}
            style={{ background: "none", border: "none", color: dirty ? theme.accent.primary : theme.text.muted, cursor: dirty ? "pointer" : "not-allowed", fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold }}
          >
            Save
          </button>
        )}

        {!editing && communityState === "update" && updateEntry && (
          <button
            data-testid="skills-update"
            onClick={() => onUpdate(updateEntry)}
            style={{ background: "none", border: "none", color: theme.accent.primary, cursor: "pointer", fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold }}
          >
            Update
          </button>
        )}

        {store.canExportToAgent && (
          <div style={{ position: "relative" }}>
            <button
              data-testid="skills-copy-toggle"
              onClick={onCopyMenuToggle}
              style={{
                background: "none",
                border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
                borderRadius: theme.radius.xl,
                color: theme.accent.primary,
                cursor: "pointer",
                fontSize: theme.fontSize.sm,
                fontWeight: theme.fontWeight.semibold,
                padding: `${theme.spacing.xxs} ${theme.spacing.md}`,
              }}
            >
              Add to Claude ▾
            </button>
            {copyMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: theme.spacing.xxs,
                  background: theme.bg.raised,
                  border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
                  borderRadius: theme.radius.sm,
                  boxShadow: theme.shadow.lg,
                  zIndex: theme.z.menu,
                  minWidth: theme.size.menuMin,
                }}
              >
                {EXTERNAL_AGENTS.map((a) => (
                  <button
                    key={a.id}
                    data-testid={`skills-copy-${a.id}`}
                    onClick={() => onCopyToAgent(a.id, a.label)}
                    style={{
                      display: "block",
                      width: "100%",
                      background: "none",
                      border: "none",
                      color: theme.text.primary,
                      cursor: "pointer",
                      fontSize: theme.fontSize.sm,
                      padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                      textAlign: "left",
                    }}
                  >
                    Add to {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: theme.borderWidth.hairline, background: theme.bg.surface, borderRadius: theme.radius.sm, padding: theme.borderWidth.thin }}>
          <button data-testid="skills-view-toggle" onClick={onEnterView} style={segBtnStyle(!editing)}>View</button>
          <button data-testid="skills-edit-toggle" onClick={onEnterEdit} style={segBtnStyle(editing)}>Edit</button>
        </div>

        {store.canReveal && (
          <button data-testid="skills-reveal" title="Reveal" onClick={onReveal} style={{ background: "none", border: "none", color: theme.accent.primary, cursor: "pointer", fontSize: theme.fontSize.sm }}>⤴</button>
        )}
        <button data-testid="skills-delete" title="Delete skill" onClick={onDelete} style={{ background: "none", border: "none", color: theme.text.secondary, cursor: "pointer", fontSize: theme.fontSize.sm }}>Delete</button>
      </div>

      {editing ? (
        <textarea
          data-testid="skills-editor"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          style={{
            flex: 1,
            resize: "none",
            background: theme.bg.surface,
            color: theme.text.primary,
            border: "none",
            outline: "none",
            fontFamily: "monospace",
            fontSize: theme.fontSize.sm,
            padding: theme.spacing.md,
          }}
        />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: theme.spacing.md, display: "flex", flexDirection: "column", gap: theme.spacing.md }}>
          <span data-testid="skills-provenance" style={{ fontSize: theme.fontSize.xxs, color: theme.text.muted }}>{provenance}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xs }}>
            <span data-testid="skills-description-label" style={{ fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.semibold, color: theme.text.tertiary }}>DESCRIPTION</span>
            <span data-testid="skills-description" style={{ fontSize: theme.fontSize.smMd, color: theme.text.secondary }}>{skill.description}</span>
          </div>
          <div style={{ borderTop: `${theme.borderWidth.hairline} solid ${theme.border.subtle}` }} />
          {/* No markdown renderer exists in this repo yet (T3 scan) — body shown as preformatted
              text (whitespace/line breaks preserved) rather than pulling in a markdown dependency. */}
          <div data-testid="skills-body" style={{ fontSize: theme.fontSize.smMd, color: theme.text.secondary, whiteSpace: "pre-wrap" }}>
            {body}
          </div>
        </div>
      )}
    </>
  );
}
