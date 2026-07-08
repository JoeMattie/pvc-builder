# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**All planned phases (0–5) are complete.** The Vite/React/TS app: draw straight pipe (SketchUp-style
snapping/inference, PBR pipe at true OD, select + drag endpoints, edit exact lengths); SCH 40 fittings
inferred and drawn at each joint (`resolveFittings` + procedural meshes) with conflicts flagged; draw
**formed (heat-bent) pipe** as smooth splines (developed length + bend schedule + min-bend-radius) with
overlapping members outlined red; **pivots** with a locked-length `solve()` boundary running
deterministic kinematics (FK + IK) — articulate via sliders + drag-to-rotate, lengths preserved, with a
mobility readout; a **BOM/cut-list** with socket take-offs + CSV; JSON export/import; bundled examples;
and a Playwright smoke on the built app. **The solver is closed-form kinematics, not CrashCat** — see
DECISIONS.md. Fitting take-off constants and reducer take-offs are documented estimates to replace with
manufacturer tables. Future work lives in the planfile's spirit, not a fixed phase list. The
authoritative spec is
`docs/planfiles/PLANFILE-pvc-builder.md` — read the relevant section before each phase; it defines the
product, domain model, phased build plan, and acceptance criteria. `DECISIONS.md` logs choices already
made (newest first) — check it before revisiting a decision.

The sibling project **riglab** (`/home/joe/dev/riglab`, readable from here) is the reference
codebase: this app deliberately mirrors its stack and copies its pure math, schema/migration runner,
solver boundary, persistence, and state patterns. When implementing, prefer copying and adapting
riglab's proven code over writing from scratch (specific files are cited throughout the planfile).
Note riglab uses konva (2D) + rapier/planck (physics); PVC Builder drops those — it is three.js-only
and its physics is CrashCat (Phase 4).

## What this app is

PVC Builder is a **3D-first, isometric PVC design studio** (SketchUp-for-PVC): draw pipe runs in a 3D
viewport, and the correct SCH 40 fittings are **inferred and drawn automatically** as members join.
It complements riglab (a rigorous test-first PVC rig engineering tool) by trading full TDD for speed
and visual polish, keeping tests focused on the pure math. Scope is 1/2" and 3/4" SCH 40 PVC only;
no backend, no network, static assets only.

## Commands

```
npm run dev          # Vite dev server
npm run build        # production build
npm run preview      # serve the production build (Playwright smoke runs against this)
npm run typecheck    # tsc --noEmit
npm run lint         # biome check .
npm run lint:fix     # biome check --write .
npm run test         # vitest run
npm run test:watch
npm run e2e          # playwright test (deferred to Phase 5; no e2e tests/config yet)
```

Run a single Vitest file: `npx vitest run src/path/to/file.test.ts`.

**Node is provided by nvm and is not on the default PATH.** Prefix commands (or source once per
shell): `export NVM_DIR="$HOME/.config/nvm"; . "$NVM_DIR/nvm.sh"` (Node 26 / npm 11).
Definition of done for any task: `npm run typecheck`, `npm run lint`, and `npm run test` all green,
`npm run build` succeeds and the built app works, and DECISIONS.md + the planfile are updated for
anything decided or changed.

## Architecture — the boundaries that matter

The design is organized around **pure cores behind narrow interfaces**, so the geometry, fitting, and
physics logic can be tested and reasoned about without three.js/React/engine types leaking in.

- **Domain doc (`Design`)** is the single source of truth, defined in **Zod** (`z.infer` for types),
  stored **SI internally** (metres, radians; imperial is display-only). A `Design` holds `nodes`,
  `members` (a discriminated union of `straight` and heat-bent `formed` splines), `pivots`
  (revolute joints), and `wraps` (heat-wrapped tees — a branch flattened + wrapped around an intact
  pipe body, rigid/screwed or a natural pivot; **schema v4**). Fitting dimensions live in a static
  **`PipeSpec`** constant table (ASTM SCH 40 values), **not** in the document.

- **Fittings are never stored** — `resolveFittings(design)` is a **pure function** that classifies the
  pipe ends incident at each node into couplings / elbows / tees / crosses / reducers, or flags
  conflicts (§4 of the planfile has the full classification table). Its signature contains no
  three/UI/physics types. Output feeds both rendering and BOM. This is the core feature and **must be
  tested** across every classification case.

- **Solver behind `solve(design, inputs, mode)`** (`src/solver/index.ts`) — **no three/UI/physics
  (CrashCat) types cross this interface** (see the exact types in §5). Design/unlocked mode is *not*
  physics: direct manipulation edits node positions and `solve()` returns positions unchanged. Only
  when `lengthsLocked` is true does pose mode build a CrashCat world (members → rigid bodies, pivots →
  hinge constraints, non-pivot joints → fixed constraints) inside `src/solver/crashcat/`. Because the
  engine's determinism is untested, the **pivot math is acceptance-tested against closed-form**
  (single hinge traces a fixed-radius arc; slider angle ⇒ analytic end position; drag preserves every
  member length) with tolerance bands — trust the tests, not the engine.

- **BOM (`bom(design)`)** is pure: per-pipe cut length = centre-to-centre span minus each end's fitting
  take-off, plus fitting counts and (for formed pipe) developed length + bend schedule. Take-off and
  developed-length math **must be covered by Vitest**.

- **Rendering** (three.js + @react-three/fiber + drei) is the impure outer layer: orthographic iso
  camera by default with a perspective toggle, procedural fitting meshes generated from `PipeSpec`,
  PBR pipe at true OD. Keep a `FittingMesh` interface as the seam for swapping in real CAD later.

- **State**: `zustand` + `zundo` (temporal undo, limit 100) + `immer`. Mirror riglab's split:
  `appStore` = the persisted/undoable document with a single `updateCurrent` mutation path and gesture
  batching for drags; `editorStore` = transient tool/selection/view state (resolved fittings cached
  here), never persisted or undone.

- **Editing flow (built in Phase 1)**: pure `Design → Design` transforms in `src/design/docOps.ts`,
  pure SketchUp-style snapping in `src/design/snapping.ts`, bridged to the stores by ONE action layer
  `src/state/editorActions.ts` that **both the pointer tools and the `window.__pvc` debug hook call** —
  so scripted checks drive exactly what the pointer drives. The 3D scene lives in `src/ui/scene/*`
  (`Scene`, `DrawController` = ground raycast + draw preview, `SelectionHandles` = endpoint drag,
  `PipeLayer` + pure `pipeModel.ts`). When adding an interaction, put the logic in docOps/snapping
  (tested) and expose it through `editorActions` + a `__pvc` seam, not inline in a component.

- **Persistence**: Dexie (IndexedDB) project store + autosave + JSON export/import (`<slug>.pvc.json`),
  mirroring `riglab/src/persistence/*`.

## Conventions to hold

- **Solver stays pure**: no three/UI/CrashCat types in `solve()`'s interface. Same for
  `resolveFittings` and `bom`.
- **Zod is the single source of truth**: every schema change bumps `schemaVersion` and adds a
  migration (copy the migration runner from `riglab/src/schema/migrations.ts` + `common.ts`).
- **Pin exact dependency versions** (no `^`/`~`); match riglab's pins unless a newer stable exists,
  and record any bump in DECISIONS.md.
- **Biome zero-diagnostics**; 2-space, single quotes, width 100. No runtime network; static assets only.
- Solver + BOM + fitting math are covered by **Vitest** (the primary loop). **Playwright** stays a
  tiny smoke suite against the built app, not part of the dev loop.
- **Browser verification is scripted, not driven**: assert state through the `window.__pvc` debug hook
  in a single `page.evaluate` (seams: `getDoc`, `getEditor`, `resolveFittings`, `getSolve`,
  `getConflicts`, `setTool`, `setSize`, `setLengthsLocked`, `setPivotAngle`, `loadExample`).
  Interactive driving only for gesture-feel checks (drag/snap).
- **No creature-specific identifiers or UI strings** — generic examples only (e.g. "camera tripod",
  "cube frame", "articulated arm"), carrying riglab's rule.
- Log the already-made architectural decisions in **DECISIONS.md** at Phase 0 (see planfile §10).
