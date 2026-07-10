import { temporal } from 'zundo';
import { create } from 'zustand';
import { EXAMPLES } from '../examples';
import { createAutosaver } from '../persistence/autosave';
import { importDesignJson } from '../persistence/exportImport';
import { getUnitsPref, setLastProjectId } from '../persistence/prefs';
import {
  type ProjectRevisionSummary,
  ProjectStore,
  type ProjectSummary,
} from '../persistence/projectStore';
import type { Design } from '../schema';

// Project lifecycle + the single document-mutation path (updateCurrent).
// Undo/redo: zundo temporal history over the document only (planfile §2),
// limit 100; history pauses during drag gestures so a drag is one undo step,
// and clears when switching projects. When the temporal past is exhausted,
// undo keeps going: it steps backward through the project's PERSISTED
// revision history (the Dexie revisions the autosaver mints), one saved
// revision per press; redo walks forward through the visited revisions before
// resuming temporal redo. Revision steps never enter temporal history and
// never mint new revisions.

export type SaveState = 'saved' | 'saving';

export interface AppState {
  projects: ProjectSummary[];
  current: Design | null;
  saveState: SaveState;
  /** true while a drag gesture (endpoint/move/rotate) is batching updates —
   * chrome can suppress hover popups etc. during the drag */
  gestureActive: boolean;
  refreshProjects(): Promise<void>;
  createProject(name: string): Promise<void>;
  /** Create a new project seeded from a bundled example, then open it. */
  createFromExample(exampleId: string): Promise<void>;
  openProject(id: string): Promise<void>;
  closeProject(): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;
  duplicateProject(id: string, name?: string): Promise<void>;
  listProjectRevisions(id: string): Promise<ProjectRevisionSummary[]>;
  restoreRevision(projectId: string, revId: number): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Apply a document change; persisted via debounced autosave. */
  updateCurrent(update: (doc: Design) => Design): void;
  /** Persist doc-stored viewport/UI state (camera, tool, projection, drawSize)
   * WITHOUT creating an undo entry — camera moves and tool switches must not be
   * undoable. Autosaved. */
  setViewport(patch: Partial<NonNullable<Design['viewport']>>): void;
  importProject(fileText: string): Promise<void>;
  /** Import a design file and open it as a new project. */
  importAndOpen(fileText: string): Promise<void>;
  undo(): void;
  redo(): void;
  /** batch many updates (e.g. a drag gesture) into one undo step */
  beginGesture(): void;
  endGesture(): void;
}

/** Structural equality ignoring `viewport` (camera churn is not an edit) —
 * used to skip revision snapshots identical to what's already on screen. */
function sameDesign(a: Design, b: Design): boolean {
  return deepEqual({ ...a, viewport: undefined }, { ...b, viewport: undefined });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      k in b && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export function createAppStore(store: ProjectStore = new ProjectStore()) {
  const useStore = create<AppState>()(
    temporal(
      (set, get) => {
        let gestureStart: Design | null = null;

        // —— undo past the temporal floor: persisted-revision walk ——
        // Only revisions minted BEFORE the project opened are walkable; the
        // session's own autosaves are duplicates of states temporal covers.
        let sessionBaseRevId: number | undefined;
        // revId `current` is showing (null = the live, non-historical doc)
        let revCursor: number | null = null;
        // docs replaced by back-steps, for redo (with the cursor to restore)
        let revForward: Array<{ doc: Design; cursor: number | null }> = [];
        // a revision load is in flight — undo/redo presses are ignored
        let revBusy = false;

        const resetRevisionWalk = () => {
          revCursor = null;
          revForward = [];
        };

        const beginRevisionSession = async (projectId: string) => {
          resetRevisionWalk();
          sessionBaseRevId = await store.latestRevisionId(projectId);
        };

        const autosaver = createAutosaver(async (doc) => {
          await store.saveProject(doc);
          // only report "saved" if no newer edit got scheduled meanwhile
          if (!autosaver.hasPending()) {
            set({ saveState: 'saved' });
            void get().refreshProjects();
          }
        });

        // Persists revision-walk resting states WITHOUT minting a revision
        // (the doc already IS one) — stepping through history must not write
        // history. Debounced like the autosaver, so rapid steps coalesce.
        const revisionSaver = createAutosaver(async (doc) => {
          await store.putProject(doc);
          if (!revisionSaver.hasPending() && !autosaver.isDirty()) {
            set({ saveState: 'saved' });
            void get().refreshProjects();
          }
        });

        /** Set `current` with temporal PAUSED — a revision step must not
         * create a temporal past entry (the next undo would bounce forward)
         * and must not clear the temporal future (undone session edits stay
         * redoable after walking forward out of the revisions). */
        const setCurrentSilently = (doc: Design) => {
          const t = useStore.temporal.getState();
          const wasTracking = t.isTracking;
          t.pause();
          set({ current: doc, saveState: 'saving' });
          if (wasTracking) t.resume();
        };

        /** Undo has exhausted the temporal past: load the next-older persisted
         * revision and show it. Async (Dexie) while undo() is sync — guarded
         * by revBusy; presses during a load are dropped, never interleaved. */
        const stepRevisionBack = async () => {
          const cur = get().current;
          const base = sessionBaseRevId;
          if (!cur || base === undefined || revBusy || get().gestureActive) return;
          revBusy = true;
          try {
            const revs = (await store.listRevisions(cur.id)).filter((r) => r.revId <= base);
            let idx: number;
            if (revCursor === null) {
              idx = 0;
            } else {
              const at = revs.findIndex((r) => r.revId === revCursor);
              if (at < 0) return; // cursor revision trimmed away — treat as exhausted
              idx = at + 1;
            }
            for (; idx < revs.length; idx++) {
              const rev = revs[idx];
              if (!rev) continue;
              const doc = await store.loadRevisionDoc(cur.id, rev.revId);
              if (!doc) continue;
              const live = get().current;
              if (!live || live.id !== cur.id) return; // project switched mid-load
              if (sameDesign(doc, live)) continue; // duplicate snapshot — keep walking
              revForward.push({ doc: live, cursor: revCursor });
              revCursor = rev.revId;
              // keep the user's camera; the historical doc supplies the design
              const next: Design = { ...doc, viewport: live.viewport };
              setCurrentSilently(next);
              revisionSaver.schedule(next);
              return;
            }
            // nothing older that differs — bottom of history, no-op
          } finally {
            revBusy = false;
          }
        };

        return {
          projects: [],
          current: null,
          saveState: 'saved',
          gestureActive: false,

          async refreshProjects() {
            set({ projects: await store.listProjects() });
          },

          async createProject(name) {
            // new projects inherit the last units choice (localStorage UI pref)
            const doc = await store.createProject(name, undefined, getUnitsPref());
            setLastProjectId(doc.id);
            set({ current: doc, saveState: 'saved' });
            useStore.temporal.getState().clear();
            await beginRevisionSession(doc.id);
            await get().refreshProjects();
          },

          async createFromExample(exampleId) {
            const example = EXAMPLES.find((e) => e.id === exampleId);
            if (!example) throw new Error(`no example ${exampleId}`);
            // a fresh id so the same example can be opened many times
            const doc: Design = { ...example.load(), id: crypto.randomUUID() };
            await store.saveProject(doc);
            setLastProjectId(doc.id);
            set({ current: doc, saveState: 'saved' });
            useStore.temporal.getState().clear();
            await beginRevisionSession(doc.id);
            await get().refreshProjects();
          },

          async openProject(id) {
            const doc = await store.loadProject(id);
            if (!doc) throw new Error(`no project ${id}`);
            setLastProjectId(id);
            set({ current: doc, saveState: 'saved' });
            useStore.temporal.getState().clear();
            await beginRevisionSession(id);
          },

          async closeProject() {
            await autosaver.flush();
            await revisionSaver.flush();
            setLastProjectId(null);
            set({ current: null, saveState: 'saved' });
            useStore.temporal.getState().clear();
            resetRevisionWalk();
            sessionBaseRevId = undefined;
            await get().refreshProjects();
          },

          async renameProject(id, name) {
            await store.renameProject(id, name);
            const cur = get().current;
            if (cur?.id === id) set({ current: { ...cur, name }, saveState: 'saved' });
            await get().refreshProjects();
          },

          async duplicateProject(id, name) {
            await store.duplicateProject(id, name);
            await get().refreshProjects();
          },

          async listProjectRevisions(id) {
            return store.listRevisions(id);
          },

          async restoreRevision(projectId, revId) {
            const doc = await store.restoreRevision(projectId, revId);
            if (get().current?.id === projectId) {
              set({ current: doc, saveState: 'saved' });
              useStore.temporal.getState().clear();
              // sessionBaseRevId stays as-of-open: the restore just minted a
              // NEW revision (excluded), duplicating a walkable old one
              resetRevisionWalk();
            }
            await get().refreshProjects();
          },

          async deleteProject(id) {
            await store.deleteProject(id);
            const cur = get().current;
            if (cur?.id === id) {
              set({ current: null });
              resetRevisionWalk();
              sessionBaseRevId = undefined;
            }
            await get().refreshProjects();
          },

          updateCurrent(update) {
            const cur = get().current;
            if (!cur) return;
            // a real edit branches off any revision walk — forward history is
            // gone, and this doc persists via the normal (minting) autosaver
            resetRevisionWalk();
            revisionSaver.cancel();
            const next = update(cur);
            set({ current: next, saveState: 'saving' });
            autosaver.schedule(next);
          },

          setViewport(patch) {
            const cur = get().current;
            if (!cur) return;
            const next: Design = { ...cur, viewport: { ...cur.viewport, ...patch } };
            // paused → this change is NOT recorded in undo history
            const t = useStore.temporal.getState();
            t.pause();
            set({ current: next, saveState: 'saving' });
            t.resume();
            autosaver.schedule(next);
          },

          async importProject(fileText) {
            const doc: Design = { ...importDesignJson(fileText), id: crypto.randomUUID() };
            await store.saveProject(doc);
            await get().refreshProjects();
          },

          async importAndOpen(fileText) {
            // a fresh id so importing never clobbers an existing project
            const doc: Design = { ...importDesignJson(fileText), id: crypto.randomUUID() };
            await store.saveProject(doc);
            setLastProjectId(doc.id);
            set({ current: doc, saveState: 'saved' });
            useStore.temporal.getState().clear();
            await beginRevisionSession(doc.id);
            await get().refreshProjects();
          },

          undo() {
            if (revBusy) return; // a revision load is in flight — drop the press
            const t = useStore.temporal.getState();
            if (t.pastStates.length > 0) {
              t.undo();
              const cur = get().current;
              if (cur) {
                set({ saveState: 'saving' });
                autosaver.schedule(cur);
              }
              return;
            }
            // in-session history exhausted — step back one persisted revision
            void stepRevisionBack();
          },

          redo() {
            if (revBusy) return; // a revision load is in flight — drop the press
            // Walking forward through visited revisions takes priority over
            // temporal redo. (Both CAN coexist: back-stepping starts only once
            // the temporal PAST is empty, but the temporal FUTURE may still
            // hold undone session edits — the forward stack returns to the
            // temporal floor first, then temporal redo resumes from there.)
            const entry = revForward.pop();
            if (entry) {
              revCursor = entry.cursor;
              setCurrentSilently(entry.doc);
              revisionSaver.schedule(entry.doc);
              return;
            }
            useStore.temporal.getState().redo();
            const cur = get().current;
            if (cur) {
              set({ saveState: 'saving' });
              autosaver.schedule(cur);
            }
          },

          beginGesture() {
            gestureStart = get().current;
            useStore.temporal.getState().pause();
            set({ gestureActive: true });
          },

          endGesture() {
            const final = get().current;
            const temporal = useStore.temporal.getState();
            if (gestureStart && final && final !== gestureStart) {
              // one history entry for the whole gesture, restoring to the
              // PRE-gesture state: silently rewind while paused, then replay
              // the final state with history recording on
              set({ current: gestureStart });
              temporal.resume();
              set({ current: final });
            } else {
              // click without change — no history entry
              temporal.resume();
            }
            gestureStart = null;
            set({ gestureActive: false });
          },
        };
      },
      {
        partialize: (s) => ({ current: s.current }),
        equality: (past, cur) => past.current === cur.current,
        limit: 100,
      },
    ),
  );
  return useStore;
}

export const useAppStore = createAppStore();
