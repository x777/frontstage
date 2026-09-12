export const CURRENT_SCHEMA_VERSION = 3;

type Doc = Record<string, unknown>;
type Migration = (doc: Doc) => Doc;

function newId(): string {
  return crypto.randomUUID();
}

/** Palmier ProjectFile.decode: a bare Timeline becomes { timelines: [legacy] }. */
function wrapBareTimeline(doc: Doc): Doc {
  if (Array.isArray(doc.timelines) && doc.timelines.length > 0) {
    const { schemaVersion: _sv, ...rest } = doc;
    return rest;
  }
  const { schemaVersion: _sv, timelines: _t, activeTimelineId: _a, openTimelineIds: _o, viewStates: _v, ...rest } = doc;
  const id = typeof rest.id === "string" && rest.id ? rest.id : newId();
  const timeline = {
    ...rest,
    id,
    name: typeof rest.name === "string" && rest.name ? rest.name : "Timeline 1",
    markers: Array.isArray(rest.markers) ? rest.markers : [],
  };
  return {
    timelines: [timeline],
    activeTimelineId: id,
    openTimelineIds: [id],
  };
}

// Migrations are keyed by the version they upgrade FROM. To upgrade a v0
// (pre-versioning macOS) document to v1 we rely on field-level tolerance in
// the schemas (defaults + the Transform x/y preprocess), so this is a
// structural no-op that exists to anchor the framework for future bumps.
// v1→v2: effects/blendMode fields added (optional), no structural change needed.
// v2→v3: wrap a bare Timeline as ProjectFile { timelines, activeTimelineId }.
const MIGRATIONS: Record<number, Migration> = {
  0: (doc) => doc,
  1: (doc) => doc,
  2: wrapBareTimeline,
};

export function migrateProjectJson(raw: unknown): Doc {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("migrateProjectJson: expected a JSON object");
  }
  let doc = { ...(raw as Doc) };
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`migrateProjectJson: no migration from version ${version}`);
    doc = migrate(doc);
    version += 1;
  }
  doc.schemaVersion = CURRENT_SCHEMA_VERSION;
  return doc;
}
