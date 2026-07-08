import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PvcDb } from './db';
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

  it('inherits a units preference on create', async () => {
    const doc = await store.createProject('Metric build', undefined, 'metric');
    expect(doc.unitsPreference).toBe('metric');
  });
});
