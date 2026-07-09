# PLANFILE — PVC Builder (3D-first PVC design studio)

> Seed planfile for a **new, standalone app** at `~/dev/pvc-builder` (a sibling of
> `~/dev/riglab`). Copy this file to `~/dev/pvc-builder/docs/planfiles/PLANFILE-pvc-builder.md`
> and start a fresh Claude session there to execute it. All `/home/joe/dev/riglab/...`
> paths below are readable from the sibling for copying reference code.

## Context — why we're building this

riglab (`~/dev/riglab`) is a rigorous, test-first PVC **rig engineering** tool. PVC Builder is
its complement: a **fast, visually-polished, 3D-first design studio** for sketching PVC
constructions the way SketchUp sketches buildings. The goal is speed and feel — open, draw,
join, inspect in seconds — with fittings chosen and drawn **automatically** as you build. It
reuses riglab's proven stack, pure geometry math, and solver/schema *patterns*, but is its own
app with its own git history, and deliberately trades riglab's full-TDD discipline for pragmatic,
math-focused tests so iteration stays fast.

Intended outcome: a user draws pipe primitives in a 3D isometric view, joins them, watches the
correct SCH 40 fittings appear, freely adjusts dimensions, and — with lengths globally locked —
rotates heat-formed pivots around each other to explore articulated poses.

## 1. Product principle, goals, non-goals

**Principle:** 3D-first, isometric by default, polished enough that pipe looks like pipe. Every
interaction is fast and direct; fittings are inferred, never hand-placed. Painfully simple physics.

### Goals (v1)
- 3D viewport: **orthographic isometric by default**, freely orbitable, one-toggle **perspective** mode.
- SketchUp-like drawing: click to lay pipe runs on a ground plane with **axis inference + snapping**
  (to world axes, existing nodes, on-pipe points).
- A floating **pillbox** toolbar (tools + **size checkboxes for 1/2" and 3/4" SCH 40**).
- **Automatic fitting selection**, drawn in place: coupling, 45°/90° elbow, tee, cross, cap, and
  **reducer** where a 1/2" and 3/4" pipe meet. Non-standard joint angles are flagged as conflicts
  (or realized as a heat-formed bend/pivot).
- **Formed pipe as splines** (heat-bent), not segmented — smooth swept tube, with developed length +
  min-bend-radius check + bend schedule.
- **Freely adjustable dimensions** (select pipe → edit length; drag endpoints with snapping).
- **Intersection highlighting** (overlapping members outlined).
- **Physics / simulation (qualitative):** a global **"lock lengths"** toggle. When locked, all pipe
  lengths and non-pivot joints freeze and wrapped/free joints articulate through deterministic
  kinematics; Play mode also runs a CrashCat rigid-body preview with elastics, mannequin collision,
  damping, and a debug overlay. This is motion preview, not load/stress analysis.
- Fast project lifecycle: list, create, open, inspect, autosave, JSON export/import; a few bundled
  example constructions.
- **BOM/cut-list** (socket take-off, fitting counts, developed lengths + bend schedule).

### Non-goals (v1)
- Sizes beyond 1/2" and 3/4" SCH 40; materials other than PVC.
- Validated real-world dynamics, force/stress analysis, or load rating.
- Real McMaster/Home Depot CAD models — fittings are **procedurally generated** from ASTM dimensions
  (a clean seam is left to swap in CAD later, but not built).
- Non-standard fittings other than the heat-formed wrapping pivot.
- Multiplayer, backend, network, analytics (static assets only, like riglab).

## 2. Tech stack (mirror riglab; copy where noted)

Same stack as riglab so knowledge and code transfer. **Pin exact versions** (no `^`/`~`). Match
riglab's pins unless a newer stable exists at adoption; record any bump in DECISIONS.md.

- **React 19 + Vite 8 + TypeScript 6** (strict; `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `@/*` → `src/*`). Copy & adapt `tsconfig.json`, `vite.config.ts`.
- **Biome 2.5** for lint+format (2-space, single quotes, width 100). Copy `biome.json`.
- **UI = shadcn/ui (New York, neutral, CSS vars) on the unified `radix-ui` package**, Tailwind v4 via
  `@tailwindcss/vite`, `cva` + `clsx` + `tailwind-merge` `cn()`, `lucide-react` icons, IBM Plex fonts
  via `@fontsource` (self-hosted, no network). **Copy** `components.json`, `src/ui/components/*`,
  `src/ui/lib/utils.ts`, and the token block from `src/index.css`.
- **3D = three.js 0.185 + `@react-three/fiber` 9 + `@react-three/drei` 10 +
  `@react-three/postprocessing` 3 + `postprocessing` 6.** r3f is declarative and composes with the shadcn shell; reuse riglab's
  `src/ui/assembly/*` (`PipeModelLayer.tsx`, `pipeModel.ts`, `scene.ts`) as rendering references.
- **Physics = `crashcat`** (npm, MIT, pure-JS). Used only inside the solver boundary (§5).
- **State = `zustand` 5 + `zundo` (temporal undo/redo, limit 100) + `immer`.** Mirror riglab's
  `src/state/appStore.ts` (single `updateCurrent` mutation path, gesture batching for drags) and
  `editorStore.ts` (transient tool/selection/view state, never persisted/undone).
- **Persistence = Dexie (IndexedDB)** project store + autosave + JSON export/import
  (`<slug>.pvc.json`). Mirror `src/persistence/*`.
- **Schema = Zod**, single source of truth (`z.infer`), `schemaVersion` + a migration per change.
  **Copy the migration runner** (`applyMigrations`/`migrateToLatest`) from
  `/home/joe/dev/riglab/src/schema/migrations.ts` and `common.ts` (Vec2/Vec3/Quaternion/id schemas).
- **Copy pure math** verbatim (with their tests): `/home/joe/dev/riglab/src/geometry/math3.ts`,
  `/home/joe/dev/riglab/src/geometry/pipe.ts` (`polylineLengthM`, `deflectionAngleRad`,
  `developedLengthM`, `bendDihedralsRad`), `/home/joe/dev/riglab/src/ui/units.ts`.
- **Testing = Vitest (+ Testing Library) for math/logic; a tiny Playwright smoke** against the built
  app driven through a `window.__pvc` debug hook (see §7). Pragmatic, not full TDD.

npm scripts mirror riglab: `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`), `lint`
(`biome check .`), `lint:fix`, `test` (`vitest run`), `test:watch`, `e2e` (`playwright test`).

## 3. Domain model (Zod schemas, SI internally)

All stored quantities SI (metres, radians); imperial is display-only (copy `units.ts`). Fitting
dimensions live in a **static spec table**, not the document.

- **`PipeSpec`** (constant module, not schema) — for each nominal size the ASTM SCH 40 values:
  `{ nominal: '1/2"' | '3/4"', odM, wallM, socketDepthM, elbow90/45 centre-to-face, tee run/branch }`.
  Seed values: 1/2" → OD 0.840 in (0.021336 m), wall 0.109 in; 3/4" → OD 1.050 in (0.02667 m),
  wall 0.113 in; socket depths ≈ 0.688 in / 0.75 in. Fill remaining take-offs from Spears SCH 40
  tables during Phase 2 and cite the source in a comment.
- **`Design` (top-level doc)** — `{ schemaVersion, id, name, unitsPreference, enabledSizes[],
  lengthsLocked, nodes[], members[], joints[] }`.
- **`Node`** — `{ id, position: Vec3 }`. A junction where pipe ends meet.
- **`Member`** — discriminated union on `kind`:
  - `straight` — `{ id, kind:'straight', nodeA, nodeB, size }`. Length is derived from node positions
    (design mode) or held rigid (locked mode).
  - `formed` — `{ id, kind:'formed', nodeA, nodeB, controlPoints: Vec3[], size, filletRadiiM?[] }`.
    A heat-bent spline (Catmull-Rom through nodeA → control points → nodeB).
- **`Joint`** (schema v5, folded the old `pivots` + `wraps`) —
  `{ id, nodeId, receiver, mover, onBody, mode, angleRad?, orientation?: Quaternion, limits? }`.
  One record per non-default pipe connection. `mode`: `anchor` (rigid/welded — only stored for an
  on-body screwed tee; a plain end-to-end anchor is the default and carries no record), `wrapped`
  (the `mover` swivels about the `receiver`'s own axis — a revolute pivot whose axis is DERIVED from
  the receiver, "always around the receiving pipe"; `angleRad`), or `free` (an eye-bolt + knotted-cord
  ball joint, 3-DOF `orientation`, drag-to-pose only). `onBody` = the mover's end sits on the
  receiver's intact span (a branch/tee) vs two ends meeting. Only two pivot kinds exist — wrapped and
  free — created by right-clicking a pipe join (Wrapped / Free / Anchor); there is no pivot tool.

**Resolved fittings are NOT stored** — they're a pure function of the design (§4), recomputed
continuously and cached in transient editor state. (Leave room to store user *overrides* later.)

Bump `schemaVersion` + add a migration for every schema change from day one.

## 4. Fitting auto-solve (pure, the core feature — must be tested)

Pure function `resolveFittings(design): { fittings: ResolvedFitting[], conflicts: Conflict[] }`.
No three/UI/physics types in its signature. For each node, gather incident pipe **ends** (unit
direction pointing away from the node along each member) and their sizes, then classify:

| incident ends | geometry | resolved fitting |
|---|---|---|
| 1 | — | open end (optional cap) |
| 2 | collinear (~180°), same size | coupling |
| 2 | collinear, different size | reducer coupling / bushing |
| 2 | ~90° | 90° elbow |
| 2 | ~45° | 45° elbow |
| 2 | other angle | **conflict** (no standard fitting) — or realize as bend/pivot |
| 3 | two collinear + one ~perpendicular, coplanar | tee (+ reducer if branch size differs) |
| 3 | other | **conflict** |
| 4 | coplanar cross (two collinear pairs ~perpendicular) | cross |
| ≥5 or non-coplanar | — | **conflict** |

Angle tolerances are a named constant (e.g. ±3°). Mixed sizes resolve to a reducing variant of the
fitting where one exists, else a conflict. A node carrying a `Joint` is exempt from standard
classification (the joint hardware — a wrapped/free pivot or a screwed on-body tee — IS its fitting).
Output feeds both rendering (§6) and BOM (§8).

## 5. Solver — physics behind a pure boundary (CrashCat)

Public interface mirrors riglab exactly — **no three/UI/CrashCat types cross it**:

```ts
// src/solver/index.ts
export type SolveMode = 'pose';                 // v1 has one mode
export type SolveInputs = {
  lengthsLocked: boolean;
  pivotAngles: Record<string, number>;          // pivotId → target angle (from sliders)
  dragTarget?: { nodeId: string; position: Vec3 };
};
export type SolveResult = {
  nodePositions: Record<string, Vec3>;
  memberTransforms: Record<string, { position: Vec3; quaternion: Quaternion }>;
  diagnostics: { mobilityDof: number; overConstrained: boolean; converged: boolean; conflicts: string[] };
};
export function solve(design: Design, inputs: SolveInputs, mode: SolveMode): SolveResult;
```

- **Design (unlocked) mode is NOT physics** — direct manipulation edits node positions; `solve()` is
  only exercised when `lengthsLocked` is true. When unlocked, `solve()` returns positions unchanged.
- **Locked (pose) mode** builds a **CrashCat world** in an adapter (`src/solver/crashcat/`, mirroring
  riglab's `src/solver/rapier/` structure — `init.ts` singleton, `solveCrashcat.ts` adapter):
  - each rigid member → a **rigid body** (length inherent, so lengths are locked by construction);
  - each **pivot** → a **Hinge constraint** on its axis. Angle sliders → **position motor** to the
    target angle; drag → a **kinematic body** (`moveKinematic`) pulling the dragged node;
  - non-pivot fitting joints → **Fixed constraints** (welded); anchors → fixed bodies.
  - fixed timestep, fixed iteration count, id-sorted construction for reproducibility.
- **Determinism caveat:** CrashCat's docs say determinism is "not deeply tested." So the pivot math is
  **acceptance-tested against closed-form** (single hinge = end traces a circular arc of fixed radius;
  slider angle θ ⇒ analytically expected end position; drag preserves every member length), with
  tolerance bands (à la riglab). We trust the tests, not the engine.
- `mobilityDof` is a Grübler-style count (rigid bodies, hinge = 1 DOF each) for a "is this rigid /
  a mechanism / over-locked" readout.

## 6. Rendering (three.js + r3f + drei)

- **Camera:** `OrthographicCamera` at the iso angle by default; a toggle swaps to `PerspectiveCamera`.
  `OrbitControls` handles middle-pan and wheel zoom; right-drag orbits around the cursor-picked
  pipe/node/ground anchor. Scene right-click menus open on button-up only if that gesture did not
  become an orbit. `GizmoHelper` axis triad.
- **Lighting/polish:** soft shadow lighting plus optional, default-off
  `@react-three/postprocessing` AO/cavity + SMAA.
  PVC PBR material (white/grey, mid roughness, faint clearcoat) so pipe reads as pipe.
- **Pipe:** straight = `CylinderGeometry`/`TubeGeometry` at true OD; formed = `TubeGeometry` swept along
  a `CatmullRomCurve3` through the control points. Reference riglab `src/ui/assembly/pipeModel.ts`.
- **Fittings:** a **procedural mesh generator** from `PipeSpec` — `LatheGeometry` bodies of revolution
  for coupling/cap/reducer, elbow = swept arc + two socket hubs, tee/cross = grouped socket-hub
  cylinders (overlapping meshes read fine; reach for `three-bvh-csg` only if unions look wrong).
  Characteristic bell/shoulder on each socket. Keep a `FittingMesh` interface as the CAD-swap seam.
- **Intersection highlight:** pure capsule-vs-capsule overlap test over members/fittings → drei
  `Selection` + `Outline` (red) on the overlapping set.
- **Dimensions/inference:** SketchUp-style inference lines while drawing (snap to X/Y/Z axes, existing
  nodes, on-pipe points); dimension labels; drag endpoints to resize.

## 7. Persistence, project lifecycle, debug hook

- Dexie project store + `autosave` + JSON `exportImport` (`<slug>.pvc.json`), mirroring riglab's
  `src/persistence/*`. A **project list** screen for fast create/open/inspect/delete.
- Bundled example designs (generic subjects only — **no creature-specific identifiers or strings**,
  carrying riglab's rule; e.g. "camera tripod", "cube frame", "articulated arm").
- **`window.__pvc` debug hook** — mirror riglab's `window.__riglab` install in the editor shell
  (merge, don't replace). Seams for scripted verification: `getDoc()`, `getEditor()`,
  `resolveFittings()` result, `getSolve()`/node positions, `getConflicts()`, `setTool`, `setSize`,
  `setLengthsLocked`, `setPivotAngle`, `loadExample(id)`, plus viewport diagnostics such as camera
  pose, scene stats, and pointer debug events.

## 8. BOM / cut-list (must be tested)

Pure `bom(design)`: per-pipe **cut length** = centre-to-centre span minus each end's fitting take-off
(socket insertion depth / face-to-centre), fitting **counts** by type + size, and for formed pipes the
**developed length** (`developedLengthM`) + **bend schedule** (`bendDihedralsRad`, both copied from
riglab `pipe.ts`). CSV export (hand-rolled). Cover the take-off math and developed-length cases with
Vitest, per riglab's "BOM math must be covered by tests" convention.

## 9. Phases & acceptance criteria (vertical slices)

Use subagents in parallel within a phase where slices are independent (scaffold vs. copy-utils vs.
schema). Each phase ends buildable + verifiable.

- **Phase 0 — Scaffold & stack.** New Vite/React/TS app; Biome/tsconfig/Tailwind/shadcn copied; fonts;
  `math3`/`pipe`/`units` copied with tests; Zod `Design` v1 (nodes + straight members) + migration
  runner; Dexie store; project list; empty 3D canvas (iso camera, orbit, ground grid) + perspective
  toggle; `window.__pvc.getDoc()`. *Accept: build+typecheck+lint+test green; create/open/delete a
  project; grid renders in iso; perspective toggles; copied geometry tests pass.*
- **Phase 1 — Draw straight pipe + realistic render.** Draw tool with axis inference + snapping; size
  from pillbox; PBR pipe at true OD; studio env + contact shadows; adjustable length (edit + drag).
  *Accept: draw a 3-pipe path, lengths match input within 1e-6 m; OD correct; snapping works (gesture
  check).*
- **Phase 2 — Fitting auto-solve + procedural meshes.** `resolveFittings` (all §4 cases + reducer +
  conflicts); procedural fitting meshes from `PipeSpec`; render fittings at joints; flag conflicts.
  *Accept: Vitest covers every classification + reducer + non-standard-angle conflict; fittings appear
  and update live as pipes move.*
- **Phase 3 — Formed (spline) pipe + intersections.** Formed-pipe tool (spline, TubeGeometry),
  developed length + min-bend-radius check + bend schedule; capsule-overlap intersection highlight.
  *Accept: developed length matches analytic (reuse `pipe.test`); formed pipe renders smooth;
  overlapping members outline red.*
- **Phase 4 — Pivots + locked-length physics (CrashCat).** Pivot tool (revolute between two members at
  a node, with axis); global lengths-locked toggle; pose mode via CrashCat behind `solve()`;
  drag-to-rotate **and** per-pivot angle sliders (position motor); mobility/over-constrained readout.
  *Accept: single-pivot end traces analytic arc within tol; slider sets angle within tol; drag
  preserves all member lengths; multi-pivot chain behaves; fixed step + tests guard reproducibility.*
- **Phase 5 — BOM + examples + polish.** `bom()` cut-list (socket take-off) + fitting counts +
  developed lengths/bend schedule; CSV export; JSON export/import round-trip; bundled examples;
  inference lines + dimension labels; tiny Playwright smoke on the built app via `window.__pvc`.
  *Accept: BOM math tested; export→import round-trips stably; smoke green on the built app.*

## 10. Conventions to carry (seed the new app's CLAUDE.md + DECISIONS.md)

- Solver stays pure behind `solve(design, inputs, mode)`; no three/UI/CrashCat types in its interface.
- Zod is the single source of truth; every schema change bumps `schemaVersion` + adds a migration.
- Pin exact dependency versions; Biome zero-diagnostics; no runtime network; static assets only.
- Solver + BOM/fitting math covered by Vitest; Playwright stays a small smoke suite (not the dev loop).
- Browser verification is **scripted, not driven** — assert state through `window.__pvc` in one
  `page.evaluate`; interactive driving only for gesture-feel (drag/snap) checks.
- No creature-specific identifiers or UI strings; generic examples only.
- **Log these already-made decisions in DECISIONS.md at Phase 0:** renderer = three.js + r3f + drei
  (over Babylon/PlayCanvas — React-first ergonomics + reuse of riglab rendering); physics = CrashCat
  behind the solver boundary, pivot math acceptance-tested because engine determinism is untested;
  fittings = procedural from ASTM dims (CAD-swap seam left, not built); mixed 1/2"+3/4" allowed with
  auto reducer fittings; pivots driven by both drag and angle sliders.

## 11. Verification (how to prove each slice works)

- **Unit/logic (Vitest):** copied geometry tests; `resolveFittings` classification/reducer/conflict
  table; pivot solve vs. closed-form arc/angle; BOM take-off + developed-length; schema
  migrate-to-latest round-trip. This is the primary loop.
- **Scripted built-app check (Playwright + `window.__pvc`):** run against `npx vite preview` on the
  production build; in a single `page.evaluate` create a design, draw pipes, assert
  `resolveFittings()` picks the expected fittings, set `lengthsLocked`, scrub a pivot angle and assert
  member lengths are preserved, export→import and assert equality. Graduate durable checks into the
  smoke suite; delete throwaways.
- **Gesture-feel (interactive, sparingly):** snapping/inference while drawing and drag-to-rotate a
  pivot — the few things a scripted assertion can't feel.
- **Definition of done per task:** tests green (incl. previously passing); `npm run build` succeeds and
  the built app works; DECISIONS.md + this planfile updated for anything decided/changed; a short
  summary of what shipped, what was deferred, and open questions.
