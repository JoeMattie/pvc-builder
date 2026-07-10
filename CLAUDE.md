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
and desktop/mobile Playwright suites on the built app. Phone editing has explicit Edit/Orbit modes,
safe-area docks, labeled command sheets, exact-length controls, and two-finger navigation guards.
**The solver is closed-form kinematics, not CrashCat** — see
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

## Navigating the code — start here

**`docs/CODE-MAP.md` is the index of the codebase.** Every source directory has a `CONTEXT.md`
orientation card (its files, key exports, cross-directory dependencies, and read-before-editing
gotchas). **Before working in a directory, read its `CONTEXT.md`** — it's the fast path from a cold
session to knowing where the relevant code is and what invariants it holds. The map is arranged in
dependency order (schema → geometry → design/solver → state → ui).

### Working with context files (keep them true)
- When you **add, rename, or move a source file**, or change a directory's role, update that
  directory's `CONTEXT.md` (and `docs/CODE-MAP.md` if a directory was added/removed).
- When you change a **cross-cutting invariant** a card documents — a pure boundary, the
  `window.__pvc` seam list, the schema version, a store's write path — fix the card in the same
  change. A stale card is worse than none; treat these like tests that must stay green.
- Keep cards terse (a reference card, not prose). Deep rationale goes in `DECISIONS.md`.

### Dispatching parallel work (subagents / agent teams)
This layout exists so tasks can be **sliced by directory and run in parallel**. To dispatch fast:
1. Point each agent at the relevant `CONTEXT.md` (and this file) as its starting context — it won't
   need to re-explore the tree.
2. **Every parallel agent works on its own git worktree + branch** (the Agent tool's
   `isolation: "worktree"`, or `git worktree add ../pvc-builder-<slug> -b feat/<slug>`), never the
   shared checkout — so working trees never collide.
3. **`docs/AGENT-COORDINATION.md` is the shared board.** Each agent **claims** the files/dirs it
   will change there before starting, checks for overlaps, and avoids the listed shared choke points
   (schema, `EditorShell.tsx`, `editorActions.ts`, `Scene.tsx`, `docOps.ts`). Release the claim when
   merged. This is how simultaneous tasks reconcile without merge pain.

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
npm run e2e          # built-app desktop + phone/tablet Playwright projects
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
  `members` (a discriminated union of `straight` and heat-bent `formed` splines), and `joints` — one
  unified record per non-default pipe connection: `mode` `anchor` (rigid/welded), `wrapped` (a pivot
  that swivels about the receiving pipe's own axis), or `free` (an eye-bolt + cord ball joint, 3-DOF),
  with `onBody` marking a branch on an intact run; **schema v10** (folded the old `pivots` + `wraps`
  in v5; later versions added viewport, measurements, elastics, mannequin/damping, and groups).
  Fitting dimensions live in a static **`PipeSpec`** constant table (ASTM SCH 40 values), **not** in
  the document.

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
  Interactive driving only for gesture-feel checks (drag/snap). (The live hook is larger than this
  list — `getFittings` returns `{fittings, conflicts}`; there is no `loadExample` seam. See
  `src/state/CONTEXT.md` for the current inventory.)
- **Live dev bridge (dev-only)**: to debug a *running* session from outside the browser (e.g. from
  Claude Code), the `apply:'serve'` Vite plugin `vite/pvcBridgePlugin.ts` relays HTTP+SSE over
  `/__pvc/*` to the browser half in `src/dev/bridgeClient.ts`, which drives `window.__pvc` and can
  return a full state dump (`__state`). An MCP front-end lives in `tools/pvc-mcp/` (auto-loaded via
  `.mcp.json`). Never ships to production (tree-shaken / `apply:'serve'`). See `tools/pvc-mcp/README.md`.
- **No new creature-specific structural identifiers or UI strings** — generic examples by default
  (e.g. "camera tripod", "cube frame", "articulated arm"). The legacy Raptor/T-rex display names
  are documented exceptions; their structural ids remain generic.
- Log the already-made architectural decisions in **DECISIONS.md** at Phase 0 (see planfile §10).
