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

describe('v4 → v5 fold (pivots + wraps → joints)', () => {
  const v4 = {
    schemaVersion: 4,
    id: 'd1',
    name: 'Articulated arm',
    unitsPreference: 'imperial',
    enabledSizes: ['1/2"'],
    lengthsLocked: false,
    nodes: [
      { id: 'n1', position: { x: 0, y: 0, z: 0 } },
      { id: 'n2', position: { x: 1, y: 0, z: 0 } },
      { id: 'n3', position: { x: 2, y: 0, z: 0 } },
      { id: 'n4', position: { x: 0.5, y: 0, z: 0 } },
      { id: 'n5', position: { x: 0.5, y: 1, z: 0 } },
    ],
    members: [
      { id: 'm1', kind: 'straight', nodeA: 'n1', nodeB: 'n2', size: '1/2"' },
      { id: 'm2', kind: 'straight', nodeA: 'n2', nodeB: 'n3', size: '1/2"' },
      { id: 'm3', kind: 'straight', nodeA: 'n4', nodeB: 'n5', size: '1/2"' },
    ],
    pivots: [
      {
        id: 'pv1',
        nodeId: 'n2',
        memberA: 'm1',
        memberB: 'm2',
        axis: { x: 0, y: 1, z: 0 },
        angleRad: 0.5,
      },
    ],
    wraps: [{ id: 'wr1', throughMember: 'm1', branchNode: 'n4', rigid: true }],
  };

  it('maps a pivot to a wrapped end-to-end joint and a rigid wrap to an on-body anchor', () => {
    const out = migrateToLatest(JSON.parse(JSON.stringify(v4)));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect('pivots' in out).toBe(false);
    expect('wraps' in out).toBe(false);
    expect(out.joints).toEqual([
      {
        id: 'pv1',
        nodeId: 'n2',
        receiver: 'm1',
        mover: 'm2',
        onBody: false,
        mode: 'wrapped',
        angleRad: 0.5,
      },
      { id: 'wr1', nodeId: 'n4', receiver: 'm1', mover: 'm3', onBody: true, mode: 'anchor' },
    ]);
  });

  it('drops a wrap whose branch member no longer exists', () => {
    const orphan = {
      ...v4,
      pivots: [],
      wraps: [{ id: 'wr9', throughMember: 'm1', branchNode: 'zz', rigid: false }],
    };
    const out = migrateToLatest(JSON.parse(JSON.stringify(orphan)));
    expect(out.joints).toEqual([]);
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
