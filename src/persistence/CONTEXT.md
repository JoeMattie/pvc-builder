# src/persistence — Dexie project store + autosave + JSON export/import + prefs

Durable state (mirrors `riglab/src/persistence/*`): documents in Dexie/IndexedDB, UI prefs in
localStorage, JSON files as `<slug>.pvc.json`. **The DB is treated as untrusted** — every load
re-runs `migrateToLatest`, exactly like an imported file.

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `projectStore.ts` (69) | `ProjectStore` class over a `PvcDb` (injectable for tests) | `listProjects`, `createProject`, `loadProject` (migrates), `saveProject` (put + revision + trim), `renameProject`, `deleteProject`, `close`; `ProjectSummary` |
| `db.ts` (32) | Dexie schema | `PvcDb` — tables `projects` (`id, updatedAt`) + `revisions` (`++revId, projectId, savedAt`), `REVISION_LIMIT=20`, `ProjectRow`/`RevisionRow` (embed full `Design`) |
| `autosave.ts` (59) | Pure debounced saver factory (no Dexie coupling) | `createAutosaver(save, delayMs=1000)` → `Autosaver` (`schedule`, `flush`, `cancel`, `isDirty`, `hasPending`) |
| `exportImport.ts` (27) | JSON export/import + filename | `exportDesignJson` (validates on the way out), `importDesignJson` (parse → migrate), `suggestedFileName` → `<slug>.pvc.json` |
| `prefs.ts` (98) | localStorage-only UI prefs | `getUnitsPref`/`setUnitsPref`, `getNightPref`, `getSnapPref`/`setSnapPref`, `get/setLastProjectId`; keys `pvc-builder.*` |

## Depends on
`../schema` only (`Design`, `createEmptyDesign`, `migrateToLatest`, `designSchema`, `UnitsPreference`).

## Read before editing
- **Trust boundary**: `loadProject`, every example load, and `importDesignJson` all re-run
  `migrateToLatest`; `exportDesignJson` validates via `designSchema.parse` so a bug can't write an
  unloadable file. Don't bypass this.
- **`autosave.ts` is storage-agnostic** — reused for both autosave and manual save via the same
  `ProjectStore.saveProject`. Subtle: `isDirty()` includes in-flight, `hasPending()` only queued.
- **`prefs.ts` split personality**: units/lastProjectId use bare `localStorage`; night/snap use a
  guarded `safeStorage()` with in-memory fallback (they're read at module-load time, before tests /
  opaque origins have working storage). `SnapPref.snapToPoints` is a legacy flag read for migration.
- **`saveProject` uses `as never`** casts for Dexie's auto-increment `revId` typing — intentional.

## Tests
`projectStore.test.ts` — vitest + `fake-indexeddb/auto`, fresh uniquely-named DB per test. CRUD,
migrate-on-load, rename, units inheritance.

_Update this file if the DB schema, autosave contract, or file naming changes._
