# HANDOFF — todo.txt batch (in progress)

> [!NOTE]
> **TODO (global tooling, not this repo):** Create a Claude Code **hook** that
> auto-writes a handoff doc like this one when the session's context hits ~**70%**,
> and **deploy it globally** (`~/.claude/settings.json`, not project-local).
> Caveat: Claude Code hooks are event-based (`PreToolUse`/`PostToolUse`/`Stop`/…),
> with **no native "context-percentage" trigger** — so this needs a creative
> mechanism (e.g. a `PreToolUse`/`Stop` hook that estimates token usage from the
> transcript and, past a threshold, injects a reminder to write/update a handoff
> doc, or blocks with guidance). Design it so it fires once per session and points
> at a stable path (e.g. `docs/HANDOFF.md`). This note is the reminder to build it.

---

## What this is
Resume point for implementing the root **`todo.txt`** batch in PVC Builder. Read
this first, then `docs/CODE-MAP.md` + the relevant `CONTEXT.md`. Full item specs +
rationale live in the plan file: **`/home/joe/.claude/plans/read-the-todo-txt-scope-starry-seal.md`**.

- **Branch:** `feat/todo-batch-wave1` (off `main`, **nothing pushed**). ~28 commits, each self-contained + green.
- **Every commit passed:** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Most UI features were driven + screenshotted in the built app.
- **Node:** not on PATH — `export NVM_DIR="$HOME/.config/nvm"; . "$NVM_DIR/nvm.sh"` (Node 26).

## Status

| Area | State |
|---|---|
| **Schema v6** (`viewport`, `lengthDisplay`, `measurements`, `joint.manufactured`) | ✅ done (+ migration + tests) |
| **Wave 1** — 4 bugs + core UX (multi-select, units, camera presets + doc-stored view/tool, ground/ball polish, hotkey badges, ctrl-drag detach, draw-entry, joint selection + switch gizmo, Y-height readout) | ✅ complete, verified |
| **Wave 2 · 2A** — Curve rename (C), snap indicators, typed-length pill | ✅ done |
| **Wave 2 · 2B** — tape-measure tool (T) | ✅ done |
| **Wave 2 · 2D** — new Bend tool (B) + draggable control points | ✅ done (length-lock toggle = follow-up; only "grow" mode) |
| **Wave 2 · 2C** — draw-on-plane tool (F) | ✅ done (angle snaps to world cardinals ±X/±Z; **pipe-relative cardinals = follow-up**) |
| **Wave 3 · 3A** — BOM wrap-allowance + end-cap extension + editor ghost | ✅ done (manufactured-union **cut-list splitting** = follow-up) |
| **Wave 3 · 3B** — manufactured joints (join menu → snap to standard elbow/coupling) | ✅ done |
| **Wave 3 · 3C** — T-rex decimation → rigid + universal-pivot examples | ✅ done |
| User-reported fixes (weld-on-drop, finite ground + dark-mode dark-gray, curve auto-junction parity, units pill next to snap pill, bend control points) | ✅ all done + verified |

## Remaining work — specifics

**2C follow-up (optional):** the plane angle currently snaps only to world cardinals
(`planeNormalFromCursor` in `editorActions.ts`). Add **pipe-relative** cardinals (align the
plane to a member incident at the clicked origin). Plane lifecycle: `placePlanePoint` →
`enterDrawPlane` (`stashPose`+`faceView`, switch to draw) → `exitDrawPlane` (`unstashPose`);
the draw constraint is `constrainDraw()` in `snapDrawPoint` + `DrawController.targetOf`.

**Wave 3** — see plan §Wave 3.
- **BOM** (`src/design/bom.ts`, pure, tested): wrapped-union material allowance (squish +
  wrap-around from receiver `odM` + bolt), shown as `18in + 8in = 26in` (new `CutItem`
  field → surface in `BomPanel`); pipe receiving a wrap at its endpoint extended `1in + 1
  radius` for an end cap, **also ghost-rendered** in the editor (hook in the pure
  `pipeModel.ts` seam — see `moverPull`/`WRAP_END_GAP_M` — rendered translucent in
  `PipeLayer`, don't mutate real geometry); split runs for manufactured unions in the cutlist.
- **Manufactured joint** (`joint.manufactured` flag exists in schema): add a "Manufactured
  joint" item to the join menu (`JoinMenu.tsx`) that replaces the joint with an off-the-shelf
  fitting and **bends the mover** so its approach angle matches the nearest standard fitting
  (45/90). Reuse `AnchorTee` rendering + `bendMember`.
- **T-rex** (`src/examples/`): decimate `~/Downloads/trexfinalfrfr.stl` (binary STL, 634
  tris, Blender) via vertex-cluster welding + drop near-collinear/degenerate edges, target
  **<200 members** (so all render layers light up — `MAX_*_MEMBERS=200`). Bake **two**
  examples: all-rigid (default anchors) and all-universal-pivot (a `free` joint per
  connection, follows the `articulatedArm` joint-push pattern in `generators.ts`). Generic
  structural ids only (no creature ids); only display name/desc may say "T-rex". Register in
  `src/examples/index.ts`; each `load()` must pass `designSchema` (migrated).

## Session gotchas / lessons (important)
- **Bent pipes render in `FormedLayer`, NOT `PipeLayer`** (straight = PipeLayer cylinders,
  formed = FormedLayer tubes). Any per-pipe interaction (bend, control points) must be wired
  in **both** layers or it "stops working" once a pipe is bent. (This bit the Bend tool.)
- **Two mirrored window-listener drag systems** (DrawController inline + SelectionHandles
  `useGroundDrag`); PipeLayer/FormedLayer bend + control drags copy the same pattern
  (`beginGesture` on down → view-plane `rayToPlane` per move → `endGesture` + re-enable
  OrbitControls on up). Keep them consistent.
- **`setViewport` is NON-undoable** (`appStore` pauses zundo `temporal`) — camera/tool
  writes must not churn undo. Camera persist is **debounced 600 ms** in `CameraPoseSync` so
  orbiting doesn't re-render the scene each frame.
- **Joint de-dup** (`dedupeJoints`) keys on `(nodeId, unordered {receiver,mover})`. Dropping
  one endpoint onto another **welds nodes** (`weldNodes` + `weldDroppedNode`, fired from the
  drag's `onEnd`) then de-dups — that's how "two overlapping pivots" is prevented.
- **`healBodyJoints` now heals formed (curve) branches too** (removed the straight-only skip),
  and `finishFormed` reconciles — so curves auto-join runs like straight pipes.
- **Solver free-pivot fix** lives in `solveLoops`/`solvePose` (`src/solver/kinematics.ts`):
  free spanning-tree joints get 3-DOF exp-map variables; the open-chain `ccd` path was
  already correct. Trust the closed-form tests, not the engine.
- **Ground**: finite 20 ft square (`GROUND_SIZE_M` in `theme.ts`); the colored fill sits at
  `y=-0.03` (below the deepest pipe radius) so pipes-on-ground aren't clipped; night ground is
  dark gray (`#2b2f38`) — lighter than the near-black sky, darker than the pipes.
- **`window.__pvc`** is the scripted-test contract (defined in `EditorShell.tsx`, camera seams
  in `Scene.tsx`). New pointer actions get a matching `__pvc` seam. Seams added this batch
  include: `setMemberSize`/`setMembersSize`, `detachMemberEnd`, `weldDroppedNode`,
  `deleteMembers`, `selectJoint`, `setLengthDisplay`, `setView`, `measure`/`getMeasurements`/
  `deleteMeasurement`, `bendMember`, `moveControlPoint`, `setTool` (now includes `measure`/`bend`).

## Verification recipe (how UI was checked)
1. `npm run build`, then `npm run preview -- --port 4188 --strictPort` (background).
2. Put a `*.verify.mjs` **inside `e2e/`** (must be in the project so `@playwright/test`
   resolves — a scratchpad path fails). Launch chromium, create/open a project, drive via
   `window.__pvc` in one `page.evaluate`, assert state, and `page.screenshot` to the scratchpad
   for visual checks. Delete the script after. Examples of the pattern are in the git history's
   verify commits (they were removed after use).
3. Pure logic (docOps/solver/bom/units/measure/bend) is covered by Vitest — the primary loop.

## Definition of done (every change)
`npm run typecheck` · `npm run lint` (biome, 2-space/single-quote/width-100) · `npm run test`
(284 passing now) · `npm run build` all green; update `DECISIONS.md`, the plan file, and any
touched `CONTEXT.md` card. Commit messages end with the `Co-Authored-By: Claude …` trailer.

## Key files touched this batch
schema: `src/schema/{design,common,migrations}.ts` · pure core: `src/design/{docOps,bom,formed}.ts`,
`src/solver/kinematics.ts`, `src/ui/units.ts` · state: `src/state/{editorStore,editorActions,appStore,cameraStore}.ts`
· scene: `src/ui/scene/{PipeLayer,FormedLayer,JointLayer,DrawController,SelectionHandles,Scene,MeasureLayer}.tsx`
· chrome: `src/ui/{EditorShell,Pillbox,SelectionPanel,BomPanel,SnapPill,UnitsPill,SizeMenu,ViewMenu,BendPill}.tsx`.
