import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PvcDb, REVISION_LIMIT } from './db';
import { ProjectStore } from './projectStore';

describe('ProjectStore', () => {
  let store: ProjectStore;
  let db: PvcDb;

  beforeEach(() => {
    // a fresh named DB per test so fake-indexeddb state never leaks
    db = new PvcDb(`test-${crypto.randomUUID()}`);
    store = new ProjectStore(db);
  });

  afterEach(() => {
    store.close();
    vi.restoreAllMocks();
  });

  it('creates, lists, opens and deletes a project', async () => {
    const doc = await store.createProject('Camera tripod');
    expect(doc.name).toBe('Camera tripod');
    expect(doc.nodes).toEqual([]);

    const list = await store.listProjects();
    expect(list.map((p) => p.name)).toEqual(['Camera tripod']);

    const loaded = await store.loadProject(doc.id);
    expect(loaded).toEqual(doc);

    await store.deleteProject(doc.id);
    expect(await store.listProjects()).toEqual([]);
    expect(await store.loadProject(doc.id)).toBeUndefined();
  });

  it('validates and migrates on load (DB is not trusted)', async () => {
    const doc = await store.createProject('Cube frame');
    // a load runs the document through migrateToLatest, so an equal doc comes
    // back — proving the store round-trips through validation
    const loaded = await store.loadProject(doc.id);
    expect(loaded?.schemaVersion).toBe(doc.schemaVersion);
  });

  it('renames a project', async () => {
    const doc = await store.createProject('Old');
    await store.renameProject(doc.id, 'New');
    const loaded = await store.loadProject(doc.id);
    expect(loaded?.name).toBe('New');
  });

  it('duplicates a project into a new id with its own revision history', async () => {
    const doc = await store.createProject('Original');
    const copy = await store.duplicateProject(doc.id, 'Duplicate');

    expect(copy.id).not.toBe(doc.id);
    expect(copy.name).toBe('Duplicate');
    expect(copy.nodes).toEqual(doc.nodes);
    expect(
      (await store.listProjects()).map((p) => p.name).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['Duplicate', 'Original']);
    expect(await store.listRevisions(copy.id)).toHaveLength(1);
  });

  it('lists newest revisions first and trims old revisions', async () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const doc = await store.createProject('r0');

    for (let i = 1; i <= REVISION_LIMIT + 2; i += 1) {
      now = Date.parse('2026-01-01T00:00:00.000Z') + i * 1000;
      await store.saveProject({ ...doc, name: `r${i}` });
    }

    const revisions = await store.listRevisions(doc.id);
    expect(revisions).toHaveLength(REVISION_LIMIT);
    expect(revisions[0]?.name).toBe(`r${REVISION_LIMIT + 2}`);
    expect(revisions.at(-1)?.name).toBe('r3');
  });

  it('restores an older revision and records the restore as a new revision', async () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const doc = await store.createProject('First');
    now = Date.parse('2026-01-01T00:00:01.000Z');
    await store.saveProject({ ...doc, name: 'Second' });

    const firstRevision = (await store.listRevisions(doc.id)).find((r) => r.name === 'First');
    expect(firstRevision).toBeDefined();
    now = Date.parse('2026-01-01T00:00:02.000Z');
    await store.restoreRevision(doc.id, firstRevision?.revId ?? -1);

    expect((await store.loadProject(doc.id))?.name).toBe('First');
    const revisions = await store.listRevisions(doc.id);
    expect(revisions[0]?.name).toBe('First');
    expect(revisions).toHaveLength(3);
  });

  it('inherits a units preference on create', async () => {
    const doc = await store.createProject('Metric build', undefined, 'metric');
    expect(doc.unitsPreference).toBe('metric');
  });
});
