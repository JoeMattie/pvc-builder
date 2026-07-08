# src/schema — Zod single source of truth + migrations + PipeSpec

The `Design` document schema (Zod, `z.infer` for types), the version-migration runner, and the
static SCH 40 dimension table. **Everything stored is SI (metres/radians)** — imperial is
display-only. Barrel: `index.ts` re-exports all.

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `design.ts` (134) | Top-level document schema | `SCHEMA_VERSION=5`, `designSchema`, `nodeSchema`, `memberSchema` (discriminated on `kind`: straight/formed), `jointSchema` (discriminated on `mode`), `jointModeSchema`, `createEmptyDesign(id, name)`, types `Design`/`Node`/`Member`/`Joint`/`JointMode` |
| `migrations.ts` (112) | Version-to-version JSON migration runner | `migrations` (keyed by version-FROM), `migrateToLatest(raw)`, `applyMigrations`, `MigrationError` |
| `common.ts` (26) | Shared primitive schemas | `vec3Schema`, `quaternionSchema`, `nominalSizeSchema` (`'1/2"'`\|`'3/4"'`), `unitsPreferenceSchema`, types `Vec3`/`Quaternion`/`NominalSize`/`UnitsPreference` |
| `pipeSpec.ts` (48) | Static ASTM SCH 40 dimension table (a const module, NOT Zod) | `PipeSpec` interface, `PIPE_SPECS`, `pipeSpec(size)` |

## The `Design` shape
- **nodes** `{id, position}` — junctions in SI metres.
- **members** — `discriminatedUnion('kind')`:
  - `straight` — `{nodeA, nodeB, size}`; **length is DERIVED**, never stored.
  - `formed` — heat-bent Catmull-Rom through `nodeA → controlPoints → nodeB`; `filletRadiiM[i]` = bend radius at `controlPoints[i]`.
- **joints** — one record per NON-default connection (`mode` discriminator). `receiver` stays put,
  `mover` pivots/branches, `onBody` = mover's end lies on receiver's intact span.
  - `anchor` — rigid/welded (only stored for on-body; end-to-end anchor is the default, no record).
  - `wrapped` — revolute pivot; axis DERIVED from receiver direction, never stored; `angleRad`.
  - `free` — ball joint, 3-DOF; `orientation` quaternion (identity = as drawn).

## Migration chain (v1 → v5)
v1 nodes+straight → **2** add `formed` → **3** add `pivots` → **4** add `wraps` → **5** folds
`pivots`+`wraps` into the unified `joints` array (old pivot→wrapped end-to-end; old wrap→on-body).

## PipeSpec table (SI; `IN=0.0254`)
| size | odM | wallM | socketDepthM |
|---|---|---|---|
| `1/2"` | 0.84·IN | 0.109·IN | 0.688·IN |
| `3/4"` | 1.05·IN | 0.113·IN | 0.75·IN |

Elbow/tee centre-to-face take-off fields exist but are **optional and unpopulated** (documented
estimates to fill from manufacturer tables).

## Read before editing
- **EVERY schema change bumps `SCHEMA_VERSION` AND adds a migration** keyed by the version it
  upgrades FROM. `migrations.test.ts` enforces this — you cannot edit a schema without touching
  `migrations.ts`.
- **`migrations.ts` must NEVER import app code** — it operates on plain JSON and must keep working
  for documents from any past version forever.
- **Derived-not-stored:** straight lengths, wrapped-joint axes, and resolved fittings are recomputed.
- **Joint discriminator is `mode`; member discriminator is `kind`** — don't conflate them.
- **DB and imports are untrusted** — `migrateToLatest` runs on every load (see `../persistence`).

_Update this file (and the migration chain above) whenever `SCHEMA_VERSION` changes._
