import { type Design, designSchema, SCHEMA_VERSION } from './design';

/** Migration from version N to N+1. Operates on plain JSON — never import app
 * code here; old documents must migrate forever (planfile §3). Copied runner
 * pattern from riglab. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version the migration upgrades FROM; every SCHEMA_VERSION bump
 * adds an entry (enforced by migrations.test). */
export const migrations: Record<number, Migration> = {
  // v1 → v2: added the `formed` member variant. Existing v1 documents (straight
  // members only) are already valid v2 documents — stamp only.
  1: (doc) => doc,
};

export class MigrationError extends Error {}

/** Run the migration chain from `from` (exclusive of `to`), stamping the new
 * schemaVersion after each step. Exported so chaining/stamping/missing-step
 * behavior stays testable while the registry is still empty. */
export function applyMigrations(
  doc: Record<string, unknown>,
  from: number,
  to: number,
  registry: Record<number, Migration>,
): Record<string, unknown> {
  let out = doc;
  for (let v = from; v < to; v++) {
    const step = registry[v];
    if (!step) throw new MigrationError(`no migration from schemaVersion ${v}`);
    out = { ...step(out), schemaVersion: v + 1 };
  }
  return out;
}

/** Upgrade an arbitrary parsed JSON document to the current schema and
 * validate it. Accepts documents written by any released schema version. */
export function migrateToLatest(
  raw: unknown,
  registry: Record<number, Migration> = migrations,
): Design {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError('design file is not an object');
  }
  let doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MigrationError(`invalid schemaVersion: ${String(version)}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `design was written by a newer app (schemaVersion ${version} > ${SCHEMA_VERSION})`,
    );
  }
  doc = applyMigrations(doc, version, SCHEMA_VERSION, registry);
  const parsed = designSchema.safeParse(doc);
  if (!parsed.success) {
    throw new MigrationError(`design failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
