export const CURRENT_SCHEMA_VERSION = 1;

type Doc = Record<string, unknown>;
type Migration = (doc: Doc) => Doc;

// Migrations are keyed by the version they upgrade FROM. To upgrade a v0
// (pre-versioning macOS) document to v1 we rely on field-level tolerance in
// the schemas (defaults + the Transform x/y preprocess), so this is a
// structural no-op that exists to anchor the framework for future bumps.
const MIGRATIONS: Record<number, Migration> = {
  0: (doc) => doc,
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
