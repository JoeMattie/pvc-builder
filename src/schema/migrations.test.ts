import { describe, expect, it } from 'vitest';
import { createEmptyDesign, SCHEMA_VERSION } from './design';
import {
  applyMigrations,
  type Migration,
  MigrationError,
  migrateToLatest,
  migrations,
} from './migrations';

describe('migrateToLatest', () => {
  it('round-trips a current-version design unchanged', () => {
    const doc = createEmptyDesign('d1', 'Camera tripod');
    const out = migrateToLatest(JSON.parse(JSON.stringify(doc)));
    expect(out).toEqual(doc);
  });

  it('rejects a non-object', () => {
    expect(() => migrateToLatest(42)).toThrow(MigrationError);
    expect(() => migrateToLatest(null)).toThrow(MigrationError);
  });

  it('rejects a missing or invalid schemaVersion', () => {
    expect(() => migrateToLatest({ id: 'x' })).toThrow(MigrationError);
    expect(() => migrateToLatest({ schemaVersion: 0 })).toThrow(MigrationError);
  });

  it('rejects a document from a newer app', () => {
    const doc = { ...createEmptyDesign('d1', 'x'), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => migrateToLatest(doc)).toThrow(/newer app/);
  });

  it('rejects a document that fails validation after migration', () => {
    expect(() => migrateToLatest({ schemaVersion: SCHEMA_VERSION })).toThrow(/failed validation/);
  });
});

describe('applyMigrations', () => {
  it('chains steps and stamps the schemaVersion after each', () => {
    const registry: Record<number, Migration> = {
      1: (d) => ({ ...d, a: 1 }),
      2: (d) => ({ ...d, b: 2 }),
    };
    const out = applyMigrations({ schemaVersion: 1 }, 1, 3, registry);
    expect(out).toEqual({ schemaVersion: 3, a: 1, b: 2 });
  });

  it('is a no-op when from === to', () => {
    expect(applyMigrations({ schemaVersion: 1, k: 'v' }, 1, 1, {})).toEqual({
      schemaVersion: 1,
      k: 'v',
    });
  });

  it('throws when a step is missing', () => {
    expect(() => applyMigrations({}, 1, 2, {})).toThrow(MigrationError);
  });
});

describe('migration registry', () => {
  it('has a migration for every version below the current one', () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) {
      expect(migrations[v], `missing migration from v${v}`).toBeTypeOf('function');
    }
  });
});
