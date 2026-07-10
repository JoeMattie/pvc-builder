import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

// prefs.ts writes lastProjectId through bare localStorage, which the node
// test environment lacks — stub an in-memory one BEFORE appStore imports it
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  });
}

import { PvcDb } from '../persistence/db';
import { ProjectStore } from '../persistence/projectStore';
import type { Design } from '../schema';
import { createAppStore } from './appStore';

// Undo past the temporal floor: Ctrl+Z walks the in-session (zundo) history
// first, then steps backward through the project's PERSISTED revisions —
// minted by the exact path autosave uses (ProjectStore.saveProject appends a
// revision per save). Redo walks forward through visited revisions before
// resuming temporal redo.

const addNode = (doc: Design, id: string, x: number): Design => ({
  ...doc,
  nodes: [...doc.nodes, { id, position: { x, y: 0, z: 0 } }],
});

const nodeIds = (doc: Design | null) => (doc ? doc.nodes.map((n) => n.id) : null);

/** Fresh isolated DB + store per call (fake-indexeddb state never leaks). */
function makeStores() {
  const ps = new ProjectStore(new PvcDb(`appstore-test-${crypto.randomUUID()}`));
  const app = createAppStore(ps);
  return { ps, app };
}

/** Seed a project whose revision history was minted honestly: each version
 * written through ProjectStore.saveProject — the same call autosave makes —
 * so every save appends a revision. Versions: A(empty) → B(n1) → C(n1,n2) →
 * D(n1,n2,n3), with D as the persisted current doc. */
async function seedProject(ps: ProjectStore, id: string) {
  const a = await ps.createProject('Camera tripod', id); // saveProject → revision A
  const b = addNode(a, 'n1', 1);
  await ps.saveProject(b); // revision B
  const c = addNode(b, 'n2', 2);
  await ps.saveProject(c); // revision C
  const d = addNode(c, 'n3', 3);
  await ps.saveProject(d); // revision D (current)
  return { a, b, c, d };
}

/** Press undo and wait for the (possibly async) result to land. */
async function undoUntil(app: ReturnType<typeof createAppStore>, ids: string[]) {
  app.getState().undo();
  await vi.waitFor(() => expect(nodeIds(app.getState().current)).toEqual(ids));
}

async function redoUntil(app: ReturnType<typeof createAppStore>, ids: string[]) {
  app.getState().redo();
  await vi.waitFor(() => expect(nodeIds(app.getState().current)).toEqual(ids));
}

describe('undo/redo across the temporal floor into persisted revisions', () => {
  it('walks temporal history first, then steps back one revision per press', async () => {
    const { ps, app } = makeStores();
    await seedProject(ps, 'p1');
    await app.getState().openProject('p1');

    // two in-session edits → temporal past has two entries
    app.getState().updateCurrent((doc) => addNode(doc, 'n4', 4));
    app.getState().updateCurrent((doc) => addNode(doc, 'n5', 5));
    expect(nodeIds(app.getState().current)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);

    // ×2 → temporal undo back to the opened doc (D)
    await undoUntil(app, ['n1', 'n2', 'n3', 'n4']);
    await undoUntil(app, ['n1', 'n2', 'n3']);

    // ×3 → temporal exhausted; steps into the newest OLDER revision. The
    // newest revision (D) is identical to what's on screen, so it's skipped.
    await undoUntil(app, ['n1', 'n2']); // C
    await undoUntil(app, ['n1']); // B
    await undoUntil(app, []); // A (empty)

    // bottom of history — a further press is a no-op
    app.getState().undo();
    await new Promise((r) => setTimeout(r, 25));
    expect(nodeIds(app.getState().current)).toEqual([]);
  });

  it('redo walks forward through visited revisions, then resumes temporal redo', async () => {
    const { ps, app } = makeStores();
    await seedProject(ps, 'p1');
    await app.getState().openProject('p1');
    app.getState().updateCurrent((doc) => addNode(doc, 'n4', 4));
    app.getState().updateCurrent((doc) => addNode(doc, 'n5', 5));

    // walk all the way down: temporal ×2, revisions ×3
    await undoUntil(app, ['n1', 'n2', 'n3', 'n4']);
    await undoUntil(app, ['n1', 'n2', 'n3']);
    await undoUntil(app, ['n1', 'n2']);
    await undoUntil(app, ['n1']);
    await undoUntil(app, []);

    // revision-forward has priority (temporal future still holds n4/n5 edits)
    await redoUntil(app, ['n1']); // B
    await redoUntil(app, ['n1', 'n2']); // C
    await redoUntil(app, ['n1', 'n2', 'n3']); // D (the pre-walk live doc)
    // …then temporal redo resumes with the undone session edits
    await redoUntil(app, ['n1', 'n2', 'n3', 'n4']);
    await redoUntil(app, ['n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('a revision step is NOT a temporal entry (undo keeps walking older, never bounces)', async () => {
    const { ps, app } = makeStores();
    await seedProject(ps, 'p1');
    await app.getState().openProject('p1');

    await undoUntil(app, ['n1', 'n2']); // straight into revisions (no session edits)
    expect(app.temporal.getState().pastStates).toHaveLength(0);
    await undoUntil(app, ['n1']);
    expect(app.temporal.getState().pastStates).toHaveLength(0);
  });

  it('an edit mid-history branches: forward stack cleared, temporal covers the pre-edit doc', async () => {
    const { ps, app } = makeStores();
    await seedProject(ps, 'p1');
    await app.getState().openProject('p1');

    await undoUntil(app, ['n1', 'n2']); // C
    await undoUntil(app, ['n1']); // B — forward stack now [D, C]

    // branch: a real edit on top of B
    app.getState().updateCurrent((doc) => addNode(doc, 'nx', 9));
    expect(nodeIds(app.getState().current)).toEqual(['n1', 'nx']);

    // redo must NOT walk forward to C — the branch cleared the stack
    app.getState().redo();
    await new Promise((r) => setTimeout(r, 25));
    expect(nodeIds(app.getState().current)).toEqual(['n1', 'nx']);

    // plain undo resumes normal temporal behavior: back to the pre-edit doc
    await undoUntil(app, ['n1']);
  });

  it('persists the resting doc WITHOUT minting new revisions while stepping', async () => {
    const { ps, app } = makeStores();
    await seedProject(ps, 'p1');
    await app.getState().openProject('p1');
    const revsBefore = await ps.listRevisions('p1');
    expect(revsBefore).toHaveLength(4); // A, B, C, D

    await undoUntil(app, ['n1', 'n2']); // step to C
    await undoUntil(app, ['n1']); // step to B

    // let the debounced revision-walk saver fire (1s debounce)
    await new Promise((r) => setTimeout(r, 1200));
    const persisted = await ps.loadProject('p1');
    expect(nodeIds(persisted ?? null)).toEqual(['n1']); // resting doc persisted…
    expect(await ps.listRevisions('p1')).toHaveLength(4); // …with NO new revision
    expect(app.getState().saveState).toBe('saved');
  }, 10_000);

  it('undo is a no-op on a fresh project with no older history', async () => {
    const { app } = makeStores();
    await app.getState().createProject('Cube frame');
    app.getState().undo();
    await new Promise((r) => setTimeout(r, 25));
    expect(nodeIds(app.getState().current)).toEqual([]);
    expect(app.getState().current).not.toBeNull();
  });

  it('switching projects clears the revision cursor and forward stack', async () => {
    const { ps, app } = makeStores();
    await seedProject(ps, 'p1');
    await ps.createProject('Other', 'p2');
    await app.getState().openProject('p1');
    await undoUntil(app, ['n1', 'n2']); // mid-walk on p1 (forward stack non-empty)

    await app.getState().openProject('p2');
    expect(app.getState().current?.id).toBe('p2');

    // redo must not resurrect p1's forward stack
    app.getState().redo();
    await new Promise((r) => setTimeout(r, 25));
    expect(app.getState().current?.id).toBe('p2');
    expect(nodeIds(app.getState().current)).toEqual([]);

    // and undo walks p2's (empty) history, not p1's
    app.getState().undo();
    await new Promise((r) => setTimeout(r, 25));
    expect(app.getState().current?.id).toBe('p2');
    expect(nodeIds(app.getState().current)).toEqual([]);
  });

  it('session autosaves do not pollute the walk (only pre-open revisions are visited)', async () => {
    const { ps, app } = makeStores();
    await seedProject(ps, 'p1');
    await app.getState().openProject('p1');

    // simulate the session's own autosave minting revisions of newer states
    // (undo() schedules saves of every resting point) — these must be skipped
    const live = app.getState().current;
    if (!live) throw new Error('no doc');
    await ps.saveProject(addNode(live, 'n9', 9)); // a NEWER state, revId > base

    await undoUntil(app, ['n1', 'n2']); // still steps back to C, not forward to n9
  });
});
