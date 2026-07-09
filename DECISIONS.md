# DECISIONS

Running log of decisions with lasting consequences for PVC Builder. Newest
first. See `docs/planfiles/PLANFILE-pvc-builder.md` for the full plan and
`CLAUDE.md` for conventions.

## Post-batch fixes (2026-07-08)

- **Instanced rendering + imperative per-frame updates** (v0.1.7). Dense articulated models were
  render-bound: the T-rex universal-pivots example drew ~3,064 separate meshes (541 pipes + a ball,
  eye bolt, and cord per hub) and re-reconciled the whole React tree every animation frame (all
  layers subscribed to `useAnim`). Fix (planned items #1 + #2): draw the repeated geometry from a
  few `InstancedMesh` and refresh transforms imperatively. `PipeLayer` now draws all pipe bodies as
  ONE instanced mesh (`InstancedPipes`); the new `InstancedFreeHubs` draws end-to-end free hubs as
  three instanced meshes (balls/eyes/cords). Both build a *structural* spec (`useMemo(…, [design])`)
  that fixes the instance order + `instanceId→id` map, then set instance matrices in `useFrame` from
  `easedPos` — **no `useAnim` subscription, so per-frame motion costs zero React re-render**. Base
  geometry is unit-sized (`instancing.ts`); size/length ride the matrix scale. Selection is a
  per-instance colour (material `color` white, `instanceColor` carries theme/select-blue); pointer
  events resolve the member/joint from `ev.instanceId`; `frustumCulled={false}` (dynamic matrices).
  Measured on trex-pivots: **~3,064 plain meshes → 97 plain + 4 instanced (2,967 instances)** — a
  ~97% draw-call cut, verified via the new `window.__pvc.sceneStats()` seam. `JointLayer`'s old
  `FreeHub` was removed (moved to `InstancedFreeHubs`); on-body free + wrap/anchor joints stay
  declarative in `JointLayer` (few). Bores/ghost caps stay declarative in `PipeDecorations` (few).
- **Dark mode by default** (v0.1.6). `getNightPref()` returns dark when unset and now persists an
  explicit day choice (`'0'`) so it sticks; the day/night toggle is on the project-list header.
- **Bend length-lock on already-bent pipes** (v0.1.4, Option B). The Bend tool's tube press-drag
  now works on FORMED pipes too (a new `FormedTube` mirrors `PipeLayer.onBend` with a click-vs-drag
  slop): dragging re-bends the pipe as one fresh bend, and with lock-length on it conserves the
  current **developed (cut) length** (`bendMemberAt` gets `lengthM = analyzeFormed(...).developedLengthM`);
  a plain click still adds a control point. Control-point handles remain for fine-tweaks (no lock).
- **Draw-on-Plane tool REMOVED** (v0.1.3). Shift-lock now covers 3D drawing (draw up any world
  axis incl. Y), so the plane tool was redundant. Deleted: the `plane` `Tool`, its `F` hotkey +
  Pillbox button, all plane state/actions (`drawPlane`/`planeOrigin`, `placePlanePoint`,
  `enterDrawPlane`/`exitDrawPlane`, `planeNormalFromCursor`, `snapPlanePoint`, `constrainDraw`),
  `PlaneQuad` rendering, the `__pvc` plane seams, the camera `stashPose`/`unstashPose`/`faceView`,
  and the 2C `planeCardinalFromCursor` helper — all were plane-only.
- **Versioned releases + in-app changelog.** EVERY commit-to-main-and-push bumps the semver version
  (patch by default, minor for a notable feature batch). The source of truth is `src/changelog.ts`
  (`CHANGELOG` newest-first + `APP_VERSION`); a "What's new" panel on the project-list page renders
  it and the header shows `v<version>`. Process on each push to main: bump `package.json` version +
  add/extend the top `CHANGELOG` entry, commit, `git tag v<version>`, then `git push origin main
  --tags`. Started at **v0.1.0**.
- **Bent pipes are editable like straight ones.** `SelectionHandles` no longer bails on formed
  members — a bent pipe now gets endpoint move handles + length arrows (drag its ends to extend /
  reposition; the curve reshapes). It's also click-selectable in select/move/rotate. And in the
  **Bend tool, clicking the tube ADDS a control point** where you clicked (`addControlPointAt` —
  inserts into the nearest polyline segment), so you can add bend handles by clicking.
- **Wrapped pivots SLIDE along the pipe (physics)** + **bent pipes are STATIC in sim.** In Play
  mode: (1) a wrapped joint is now a **cylindrical** 6DOF constraint (`sixDOFConstraint`) — free
  translation AND rotation along the receiver axis, each with friction, the other 4 DOF fixed, the
  slide bounded to the receiver's span so it can't slide off. `SLIDE_FRICTION_FORCE` (scaled N) is
  the tuning knob (rotation keeps `PIVOT_FRICTION_TORQUE`). Physics-only — the slide is emergent
  and resets on stop, so NO schema/kinematics change. (2) A **formed (bent)** member is a DYNAMIC
  rigid body just like a straight pipe — it keeps its shape (one compound body) but falls & collides
  under physics. (An earlier build made bent-pipe assemblies `STATIC`/fixed, but that anchored any
  structure containing one and read as "physics not applied" — reverted in v0.1.2.)
- **Length arrows resize along the pipe AXIS, not the ground** (bug: the yellow length arrows
  worked on horizontal X/Z pipes but not vertical Y ones, and could run backwards — regardless of
  camera). Root cause: `LengthArrow` rode a `rayToGround` (y=0) projection, which can't capture
  motion along Y. Fix: project the picking ray onto the pipe's **axis line** via
  `closestAxisPointToRay` (the same trick the move-gizmo arrows use) for both the grab capture and
  the drag — works for any orientation. Verified: a vertical pipe grows/shrinks via its arrow.
- **Snap onto pipes/nodes at ANY height — SCREEN-SPACE** (bugs: drawing on/between the Cube Frame's
  elevated top pipes snapped both ends to the ground + jittered; dragging an endpoint onto a pipe
  "usually" didn't tee). Root cause: snapping was resolved from a **ground/view-plane raycast
  point**, so an elevated pipe was far from it in 3D and never matched. A first attempt used a **3D
  ray-vs-segment** distance — WRONG: it snaps to any pipe the ray grazes *in depth* (a pipe between
  the camera and the cursor's target), firing "beyond" the pipe on screen. Fix: `pickSnapPoint`
  (`ui/scene/pipePick.ts`) projects each node + straight-pipe segment to the SCREEN and takes the
  nearest within `SNAP_PX` (12) of the cursor — nodes first, then a point along a pipe (behind-camera
  points are skipped). `DrawController.targetOf` returns that point (so `snapPoint` resolves the
  node/on-pipe/tee) and the endpoint drag (`SelectionHandles`) snaps the dragged node to it, so
  `reconcileBodyJoints` tees/welds reliably. Respects the snap-to-ends/pipes pill toggles; straight
  members only. Pure `closestOnSegment2D` in `marquee.ts`. Opt-in `__pvc.setSnapDebug(true)` logs
  what the cursor resolves to (`[snap]` / `[drag-snap]`).
- **Sim precision isolated → CCD-only** (experiment branch `sim-precision-rollback`, NOT on main
  yet). The physics tunnelling fix in 258c139 bundled three mechanisms; an 8-way sweep of a
  settling welded elbow (400 steps of 1/60 s) isolated their effect:
  - **Velocity cap (`maxLinearVelocity`): no effect at all** — results byte-identical with/without.
  - **Substeps (1/120 s ×≤8/frame) and CCD (`LINEAR_CAST`) are REDUNDANT** — either alone keeps the
    elbow from sinking through the floor (coarse+neither: node reaches y=−0.129; CCD-only: +0.003;
    substeps-only: +0.007). A plain straight-pipe fall from y=5 rests on the floor even fully
    coarse, so high-speed tunnelling wasn't the real issue — the compound-body settling sink was.
  - **Landing config: CCD ON, substeps OFF, velocity-cap OFF** — drops the up-to-8×/frame world
    stepping (the main cost) and the useless cap, keeping the one mechanism that matters. All tests
    green. `physics.ts` keeps the three as flags + `setPhysicsPrecision(...)` for manual A/B testing.
- **Toggleable drag modifiers + arrow-key nudge.**
  - **Toggleable Ctrl/Shift during a drag** (`useGroundDrag` in `SelectionHandles.tsx`). Modifier
    state is now a live `DragMods` seeded from the pointer-down and flipped by each mid-drag key
    PRESS (releases ignored), re-applied to the last point — so press-and-release switches modes
    without holding the key or moving the mouse. On the endpoint drag: **Shift** toggles world-axis
    lock; **Ctrl** toggles detach — pressing it breaks the union (`detachMemberEnd`) and pressing it
    again re-welds (`weldNodesInto` → `weldNodes`), both inside the drag's single undo step.
  - **Arrow / numpad nudge** of the selection (`EditorShell` keydown): arrows + numpad-arrows move
    the selected pipe(s) one grid step in the X/Z ground plane; **Ctrl+Up/Down**, or the numpad
    **Home/PgUp** (up) and **End/PgDn** (down), move in Y. One `translateMembersBy` per press.
- **Draw-on-plane pipe-relative cardinals** (the deferred Wave-2 2C follow-up). The wall angle
  previously snapped only to world cardinals (±X/±Z). A new pure `planeCardinalFromCursor`
  (`design/snapping.ts`) also offers, for each straight pipe touching the plane origin (an endpoint
  there or a run passing through it), that pipe's horizontal direction AND its perpendicular — so a
  wall can align to or square off an existing pipe (e.g. draw flush with a 45° run). The normal is
  signed deterministically (dominant component positive), so an axis-aligned wall reproduces the
  old cardinal normals exactly (no behaviour change without a pipe). `editorActions.planeNormalFromCursor`
  gathers the incident pipe dirs and delegates; `PlaneQuad`/`faceView` already handle an arbitrary
  (diagonal) normal.
- **Bend tool "Lock length"** (the deferred Wave-2 2D follow-up). A second BendPill toggle: with
  it on, bending a straight pipe holds the **developed (cut) length** instead of growing — the far
  end (`nodeB`) draws IN while `nodeA` stays put. Implemented in the pure `bendMember`: it bisects
  the chord so `developedLengthM` equals the material length captured at gesture start (also
  handles the lock-end-angle lead-ins; falls back to fixed ends when a gentle pull can't reach the
  target). The reference (axis + length) is frozen at pointer-down in `PipeLayer.onBend` and
  threaded through `bendMemberAt` each frame so it doesn't drift as `nodeB` moves. New
  `editorStore.bendLengthLock` + `__pvc.setBendLengthLock`; `__pvc.bendMember` gained an optional
  length-ref arg. Verified in-app: grow → cut 1.20 m; lock → cut held at 1.00 m, end drawn in.
- **T-rex re-baked as QUADS, not decimated.** The earlier examples were over-decimated (welded to
  57 nodes / 145 pipes). `scripts/gen-trex.mjs` now keeps every vertex (262, only de-duplicating
  coincident coordinates) and runs a **tris→quads** pass — greedy coplanarity-first triangle
  pairing that drops each pair's shared (flat-face) diagonal — yielding **541 pipes**. Diagonals
  on curved regions are kept (they're real structural pipes). Both examples share this wireframe:
  `trex-rigid` (schema 1, no joints) and `trex-pivots` (schema 6, a free ball hub at all 262
  nodes → 820 pairwise records, drawn as 262 balls via [[free ball-joint hub]]). To let the
  fuller model light up every layer, the `ui/scene` `MAX_*_MEMBERS` render caps were raised
  200 → 800; the 160-node animation guard is still tripped on purpose (poses snap, no easing).
- **Free ball-joint HUB for N pipes at one point** (`makeFreeHub`). A free pivot can now bind
  any number of pipes meeting at a node as a single shared ball. **No schema change** — a shared
  hub is kinematically identical to PAIRWISE free records all referencing one common receiver
  (the longest incident pipe): every pipe end is held coincident at the node yet free to orient.
  So storage stays pairwise (reusing the solver, dedupe, and reconcile paths), but it *presents*
  as one hub: the join menu's "Free" becomes "Free hub" for ≥3 pipes and frees them all in one
  action; `JointLayer` draws ONE ball per free node (`FreeHub`) with an eye-bolt + cord per
  incident pipe instead of N-1 overlapping balls; BOM counts one ball per free node. A node with
  a free joint is already exempt from standard-fitting classification, so a 5-way hub no longer
  flags a conflict. Scoped to **free** joints (per request); on-body free branches keep the
  pairwise `setJoinMode('free')` path. New `__pvc.makeFreeHub` seam. The swap gizmo is now
  restricted to WRAPPED joints (it only ever meant "which pipe wraps which").
- **3-way (side-outlet) corner elbow** added to the fitting library (`FittingType 'elbow3way'`).
  A node with three **mutually perpendicular** pipe ends (the classic cube-frame corner)
  previously flagged a conflict (`'three pipes with no straight run'`); it now resolves to a
  3-way elbow. Rendering is automatic (`HAS_BODY` → three perpendicular hubs + a corner blend
  sphere); BOM take-off reuses the 90° elbow centre-to-face factor (documented ESTIMATE). A
  coplanar Y (no straight run, not all-perpendicular) is still a conflict. Reducing 3-way
  (mixed sizes) is allowed, mirroring the cross.

## todo.txt batch — bug fixes, tools, BOM, T-rex (2026-07-08)

Implemented the root `todo.txt` batch on `feat/todo-batch-wave1` in three review-gated
waves over schema v6. Decisions of lasting consequence:

- **Free pivots under length-lock** are true 3-DOF ball joints even inside closed loops:
  `solveLoops` now varies free spanning-tree joints via 3 exp-map params (was: frozen →
  behaved like a locked axis). Open-chain CCD was already correct.
- **Overlapping joints** are prevented by `dedupeJoints` (keyed on `(nodeId, unordered
  {receiver,mover})`) folded into the heal path, and by **welding coincident nodes on drop**
  (`weldNodes`/`weldDroppedNode`) — dropping one pipe end onto another joins them.
- **Curves are treated like straight pipes** for auto-junctions: `healBodyJoints` no longer
  skips formed members and `finishFormed` reconciles.
- **Doc-stored viewport** (schema v6): a document restores its own camera/tool/projection/
  drawSize on open (not the previous doc's). Written via a **non-undoable** `appStore.setViewport`
  (zundo paused) and debounced 600 ms so orbiting doesn't churn the doc or re-render the scene.
- **Units are display-only** (`lengthDisplay`: mm/cm/in/in-frac), default decimal inches; a pure
  `parseLength` accepts `10mm`/`1/2"`/`10ft`… Nothing changes stored SI.
- **Ground** is a finite 20 ft square (not infinite); the colored fill sits below the deepest
  pipe radius so on-ground pipes aren't clipped; night ground is dark gray (lighter than sky,
  darker than pipes).
- **New tools**: Measure (persistent, schema-backed), draw-on-Plane (F, camera flips to face a
  wall plane, drawing constrained), and Bend (drag a straight pipe → heat-formed curve with
  draggable control points). Curve = the renamed heat-formed tool (hotkey C).
- **Manufactured joints** snap the mover to the nearest standard fitting angle (90/45/straight)
  and drop the pivot record, so `resolveFittings` draws a real socket fitting.
- **BOM** now adds wrapped-union fabrication allowances (mover wrap-around + bolt, padded 15%)
  and a 1"+radius end-cap extension where a pipe end receives a wrap (also ghost-rendered);
  shown as "base + allowance = cut". Constants are documented ESTIMATES.
- **T-rex** decimated from an STL (vertex-cluster weld → 57 nodes / 145 pipes, <200 cap) into
  two examples: all-rigid (v1, exercises the migration chain) and all-universal-pivot (v6, a
  `free` joint per connection). Follow-ups (noted in `docs/HANDOFF.md`): Bend length-lock,
  plane pipe-relative angle snap, manufactured-union cut-list splitting.

## Schema v6 — doc-stored UI state, persistent measurements, manufactured joints (2026-07-08)

Bumped `SCHEMA_VERSION` 5→6 for the todo.txt batch. All additions are optional
except `measurements` (required, defaults to `[]`), so the v5→v6 migration is a
trivial stamp that only backfills the empty measurements array; `viewport`,
`lengthDisplay`, and `joint.manufactured` are optional and need no migration
work. Added: (1) `viewport` — doc-stored camera pose + projection + last tool +
drawSize, so opening a document restores its own view/tool state instead of
carrying over the previous document's (written outside undo history); (2)
`lengthDisplay` (`mm|cm|in|in-frac`) — a display-only length format independent
of `unitsPreference` (which still drives mass), defaulting to decimal inches
when undefined, never changing what is stored (still SI); (3) `measurements` —
persistent tape-measure objects (each end pinned to a node or a free point, plus
a perpendicular `offsetM` for the dimension line); (4) `joint.manufactured` — a
flag marking a joint rendered as an off-the-shelf fitting. `projection`/`tool`
on `viewport` are loose strings so adding view modes / tools later never forces
another schema bump.

## CI deploys to Cloudflare Pages at pvc-builder.joemattie.com (2026-07-08)

Mirrors riglab exactly. Hosting is Cloudflare Pages free tier (project
`pvc-builder`, production URL https://pvc-builder.pages.dev), served at the
custom domain **https://pvc-builder.joemattie.com** — static assets only, the
only deployment shape the planfile permits. Deployment is a `deploy` job
appended to `.github/workflows/ci.yml`: it runs only on pushes to `main`, only
after the full `ci` job (typecheck + lint + test + build + Playwright e2e)
passes, and it deploys the exact `dist/` artifact CI built and tested
(uploaded/downloaded via actions artifacts) rather than rebuilding — so the
deployed bytes are the verified bytes. Chose direct-upload via wrangler
(pinned `wrangler@4.107.0`) over Cloudflare's Git integration so CI stays the
single gate (the Git integration builds on Cloudflare's side and would deploy
even when tests fail). CI node is 26 (matches local dev per CLAUDE.md; riglab
used 22). PR preview deployments deliberately not added (scope).

Auth is GitHub Actions secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.
The subdomain was created via the Cloudflare API (no repo change; Vite
`base: '/'` needs no change): a custom domain registered on the Pages project
plus a proxied CNAME `pvc-builder → pvc-builder.pages.dev` in the joemattie.com
zone. The Pages project + first deploy were done with a `wrangler login` OAuth
token, but that token is `zone:read`-only and can't write DNS, so the CNAME +
the CI secret use a dedicated Cloudflare API token (`Cloudflare Pages:Edit` +
`Zone:DNS:Edit`, scoped to this account / the joemattie.com zone). Chose a
subdomain over a joemattie.com path so app deploys stay decoupled from the
blog's Worker. Both URLs serve the identical production deployment.

## Fitting choice is automatic — removed "Socket fitting / cut the run" (2026-07-08)

Simplified the connection model to a single rule: **a manufactured rigid fitting
is used whenever one matches the intersection angle; a wrap+bolt union is used
for every other rigid connection; all pivots are custom (wrap) fabrications.**
Because the choice is now automatic (a 90° on-body anchor already renders as a
socket tee via `anchorRendersAsTee`; other angles render as the wrap+pin), the
manual **"Socket fitting — cut the run"** action was pure confusion and is gone:
removed `convertJointToFitting` from `docOps`, `editorActions`, the `__pvc` hook,
the right-click **JoinMenu** item, and the SelectionPanel **Fitting** button (+
its `teeAvailable` gate). The right-click join menu is now just Anchor / Wrapped
/ Free. Note the run stays topologically intact (one pipe + an on-body union)
even where it renders as a tee — switching a branch between rigid and pivot needs
no cut/uncut, and the tee's cut-list treatment is left to the BOM work.

## Wrapped/rigid joints render as a wrap-arrow indicator, not a collar (2026-07-08)

Replaced the molded slip-saddle **collar** on non-default joints with a lighter,
schematic **wrap-arrow indicator** that reads the joint's *behaviour* rather than
faking a fitting:
- **The branch pipe visually stops ~1" short of the run's surface.** `pipeModel`
  pulls back a wrapped/anchor branch end by `receiverOD/2 + 1"` (keyed by
  `${moverId}|${nodeId}` so only the branch end moves, not a run end sharing the
  node) and now draws an **open bore** there (on-body wrap nodes are no longer
  suppressed; only `free` ends stay covered by the eye-bolt/ball hardware).
- **Wrapped pivot → a GREEN arrow** that leaves the open end, loops once around
  the run, and returns near the start (the grammar of "swivels about the run").
- **Rigid on-body `anchor` → depends on the angle:** at ~90° (within ~8°) a real
  socket tee exists, so it renders as a standard **tee fitting** (`AnchorTee`
  reuses `buildFittingMesh`; the branch sockets in full, no pull-back/bore). At
  any other angle no off-the-shelf fitting fits, so it uses **the same loop in
  STEEL, capped by a red locking PIN** instead of an arrowhead ("fixed here").
  The tee-vs-wrap choice is the pure `anchorRendersAsTee` (`jointStyle.ts`), used
  by both `JointLayer` and `pipeModel` so pull-back and rendering agree.
- Geometry is a pure helper `src/ui/scene/wrapArrow.ts` (tested), swept as a
  `TubeGeometry` in `JointLayer`. Deleted `wrapMesh.ts` + `WrapStrip.tsx` (collar)
  and their test.

**Branch-on-run unions now actually form.** A tee/wrap only renders where a
`joint` exists, and a branch whose *start* landed on a pipe never got one — a
path started on a pipe body calls `startPath` (a node, no member yet), so the
`addBodyJoint` call found no branch and silently no-op'd. Such a branch read as a
red overlap instead of a tee. Fixed two ways: (1) the draw tool remembers the run
a path started on (`editorStore.drawStartWrapMember`) and creates the on-body
union once the first segment exists; (2) a pure `healBodyJoints(design)` repairs
any endpoint sitting exactly on another member's span (idempotent) and runs on
import, so already-saved files gain their unions on reload.

**Unions connect / disconnect live, mid-gesture.** `reconcileBodyJoints(design)`
(prune any on-body union whose branch left its receiver's span, then heal missing
ones) runs after every endpoint-moving edit — `dragNodeTo`, `dragMemberEndLength`,
`setMemberLength`, `translateMember`, `rotateMember` — via an `updateReconciled`
wrapper. So dragging a branch end onto a run forms a rigid union immediately (and
clears the red overlap), and dragging it away — or shortening it off the run —
removes the union at once. A union whose branch still rides the same receiver
keeps its chosen mode (wrapped/free). Pose IK (`dragLocked`) is exempt.

Also: **removed the "Solve" fabrication-detail toggle entirely** (`fabricationSolved`
state, button, and the 1" stub/endcap render) — the always-on wrap-arrow makes it
redundant. The kinematics `solve()` / Lengths-lock / pivot sliders are unchanged.
And **Ctrl/Cmd+Space now starts/stops playback** (physics) from anywhere.

## Play-mode physics: compound assemblies, lowered floor, no tunnelling (2026-07-08)

Three fixes to the CrashCat sim, all in `src/solver/physics.ts` (+ the visual grid
in `Scene.tsx`), so Play mode is stable:
- **Welds → one compound body per assembly, not per-member bodies + fixed
  constraints.** `build()` now runs the same union-find as the kinematics (weld at
  shared nodes except a pivot's mover; on-body anchors weld branch→run) and makes
  each rigid assembly a single dynamic **`staticCompound`** of capsules. Overlapping
  capsules at a union (the "end unions" the user saw erupt) can no longer fight a
  redundant `fixedConstraint`. Only pivots create constraints (wrapped→hinge,
  free→`pointConstraint`); anchors are folded into the compound.
- **Pipes never collide with each other — only the ground** (`disableCollision(
  olMoving, olMoving)`). Capsules across a pivot overlap at the joint node; the
  constraint holds them, so pipe-vs-pipe contacts were only jitter. Different
  contraptions no longer stack, which is fine here.
- **Temporary floor drop + no tunnelling.** At sim start the static floor is
  lowered to `simGroundY(design) = min(0, lowestExtentM − 3mm)` so nothing begins
  penetrating the ground (the old eruption when a model sat centred on / below
  y=0); the rendered `GroundGrid` drops with it and both reset when the sim stops
  (the world is rebuilt each Play). Thin fast pipes stopped tunnelling the floor
  via **fixed-substep** stepping (1/120 s, capped at 8 substeps/frame) + **CCD**
  (`MotionQuality.LINEAR_CAST`) + a `maxLinearVelocity` cap on the bodies.

## Pivots reworked: unified joints — wrapped + free, right-click menu (2026-07-08)

- **`pivots` + `wraps` folded into one `joints` array (schema v5).** A joint is
  *"member `mover` connects to `receiver` at `nodeId` in `mode`"*, where `mode` ∈
  `anchor` (rigid/welded), `wrapped` (swivels about the receiver's own axis — a
  revolute pivot, axis DERIVED not stored, so it's "always around the receiving
  pipe"), or `free` (an eye-bolt + knotted-cord ball joint, 3-DOF `orientation`).
  `onBody` distinguishes a branch on an intact run (the old wrap) from two ends
  meeting. Migration `4→5` maps old pivots → wrapped end-to-end joints and old
  wraps → on-body joints (`rigid` → `anchor`, else `wrapped`).
- **Only two pivot kinds, chosen by right-clicking a pipe join:** the join menu
  (`JoinMenu`, raycast in `PipeLayer` → `editorStore.joinMenu`) offers **Wrapped /
  Free / Anchor** (`joinContext` in docOps gates them). A free pivot works both
  end-to-end (two eye-bolted ends + a ball) and on-body (the branch ball-joints
  to a saddle eye bolt clamped on the run). The old **pivot tool is removed**
  (`Tool` union, Pillbox, `P`
  hotkey); creation is right-click only. Receiver auto-picks the longer pipe,
  swappable via ⇄ in the selection panel. Any join is per-pair (a tee can pivot
  one branch while the rest stay rigid).
- **Kinematics grew a spherical joint.** `solvePose` handles wrapped (revolute
  about the receiver world-axis) and free (a stored relative-rotation quaternion)
  joints together: FK, CCD IK (a free joint rotates straight toward the drag
  target — free pivots are drag-to-pose only, no sliders), and Grübler mobility
  (wrapped = 1 DOF, free = 3; planar shortcut only when all joints are wrapped +
  parallel). `SolveInputs`/`SolveResult` gained `jointOrientations`. **A wrapped
  loop is spatial** (in-plane axes aren't parallel) so a wrapped square reads as
  over-constrained −2, unlike the old parallel-Y planar 4-bar — the closed-form
  acceptance tests were rebuilt around the receiver-axis geometry.
- **Physics (CrashCat) follows suit:** anchor → fixed, wrapped → hinge about the
  receiver axis, free → `pointConstraint` (ball). **Rendering:** `JointLayer`
  replaces `PivotLayer`+`WrapLayer` — wrapped/anchor reuse `buildWrapMesh`
  (accent swivel vs screwed white), free draws two eye-bolt rings + cord + a ball
  with the pipe ends pulled back (`pipeModel` shortens at free nodes). **BOM**
  lists joint hardware (free = 2 eye bolts + ball + cord, with a ~1" eye-bolt
  take-off per butted end; wrapped/anchor = heat-wrap). Seams: `__pvc.getJoints`,
  `setJoinMode`, `swapJointReceiver`, `convertJointToFitting`, `setPivotAngle`.

## Standard socket fitting as a joint option (2026-07-07)

- **A wrap tee can be converted to a standard manufactured socket tee.** The
  selection inspector's Wrap control gained a third option — **Fitting** —
  alongside Screwed / Pivot. `convertWrapToFitting` (pure, tested) splits the run
  at the branch node into two collinear halves and drops the wrap, so the branch
  node becomes a real degree-3 junction that `resolveFittings` already
  classifies as a **tee** (rendered by FittingLayer). Seam
  `__pvc.convertWrapToFitting`.
- **Gated to angles where a real fitting fits:** the Fitting button is enabled
  only when the branch is within ~7° of perpendicular to the run (a
  manufactured tee angle). `splitMemberAt` from the earlier tee work stays for
  the non-wrap split path. **Corner (elbow) and cross fittings already resolve**
  for explicit shared-node joins at 90°/45° (Phase 2 `resolveFittings`), so
  "corner standard fittings" needed no new code — this adds the 3-way tee as a
  selectable alternative to a heat-wrap.

## Pivots render as heat-wrapped swivels + Solve fabrication (2026-07-07)

- **Every pivot now renders as a heat-wrap collar** (the accent-tinted smooth
  helix from `buildWrapMesh`, via the shared `WrapStrip`) around the receiving
  pipe at the joint, replacing the old hinge-cylinder glyph — so a pivot reads
  as a wrapped swivel. The receiving pipe = `pivot.memberA`, the wrapper =
  `memberB`; a non-straight receiver falls back to the small glyph.
- **A "Solve" toggle** (toolbar, transient `editorStore.fabricationSolved`,
  `__pvc.setFabricationSolved`) reveals the fabrication detail: the receiving
  pipe **extended 1" past the endpoint pivot** + a **PVC endcap retaining ring**
  at the stub end, so the wrap can't slide off. Off by default.
- **Kinematics unchanged:** the wrap is a *visual* treatment; the pivot axis
  stays the joint-plane normal (what makes a planar 4-bar flex), not the
  receiving-pipe axis — changing it would break the square articulation just
  fixed. The physical heat-wrap-swivel axis nuance is a modelling follow-up.
  `WrapLayer`'s renderer was extracted into `WrapStrip` and shared here.

## Heat-wrapped tee → molded slip saddle fitting (2026-07-07)

- **The wrap now renders as a molded slip saddle fitting, not a wrapped strip.**
  Per feedback ("smoothly transition into a slip fitting drawn around the
  intersecting pipe"), `buildWrapMesh` returns composed primitives in the same
  style as the socket fittings (`fittingMesh.ts`): a **collar sleeve** that slips
  over/around the through pipe (radius = OD/2 × 1.3, with bell lips), a **branch
  socket boss** the branch pipe slides into, and a **blend sphere** at the crotch
  so the branch flows smoothly into the collar. `WrapStrip` now renders those
  cylinders + spheres in molded PVC (replacing the swept-helix bufferGeometry);
  rigid wraps keep two set-screw discs, pivots are accent-tinted. Both the tee
  wraps (WrapLayer) and the pivot swivels (PivotLayer) get the fitting look.

## Smooth heat-wrapped tee — helical strip (superseded) (2026-07-07)

- **The wrap is now a smooth strip swept once around the through pipe** instead
  of the faceted band. `buildWrapMesh` returns a triangle mesh (positions +
  indices): a rectangular cross-section (flattened width π·OD/2 × a double-wall
  thickness) swept along a **single-turn helix** around the run — a solid ribbon
  (inner + outer surfaces + edges + end caps). `WrapLayer` builds one reusable
  `<bufferGeometry>` per wrap and refills it (position + `computeVertexNormals`)
  each eased frame, so it glides without leaking geometry. Rigid wraps keep the
  two steel screw discs at the branch-side seam; a pivot wrap stays accent-tinted
  (no screws). Verified in-browser — a clean smooth collar at the tee.

## Closed-loop kinematics — squares now articulate (2026-07-07)

- **Locked-length mechanisms with closed loops now close correctly.** The tree
  FK alone leaves a 4-bar's loop-closing joint open, so driving a pivot broke
  member lengths and only some pivots did anything. `solvePose` now detects
  loop-closing (back-edge) pivots and runs a **damped Gauss-Newton (Levenberg-
  Marquardt) loop closure** in `kinematics.ts`: the spanning-tree pivot angles
  are the variables; residuals are **closure** (each loop pivot's node must
  agree between its two bodies — weighted high so every member length stays
  exact), a soft **angle** pull toward each slider target (tree + loop pivots'
  measured angle, so driving ANY pivot moves the loop), and the **drag** target
  when dragging. Open chains keep the exact tree FK / CCD path unchanged.
- **`setPivotAngle` writes back the pushed-around pivots:** after setting the
  driven angle, in a locked looped mechanism it solves and writes every OTHER
  pivot's resolved angle back to the document (the driven one stays put), so the
  passive sliders track. No-op for open chains (solve is identity there).
- **Mobility readout is planar-aware.** Grübler per component now uses the
  **planar** count `3(b−1) − 2j` when a component's pivot axes are all parallel
  (else spatial `6(b−1) − 5j`); a planar 4-bar reads **1 DOF** instead of the
  spatial formula's −2. Over-constrained now means *negative* mobility, not
  merely "has a loop" (the old `fk.overConstrained` back-edge flag no longer
  marks the result over-constrained). Verified in-browser: a square of 4 pipes +
  4 pivots reads 1 DOF, and driving one pivot flexes it into a closed rhombus
  with all four side lengths preserved and the other three sliders moving.
- **Deferred:** the CrashCat Play-mode physics already handled loops; this brings
  the *kinematic* locked-pose path to parity for planar loops. General 3D
  spatial loops solve too (least-squares) but aren't separately tuned.

## Marquee (rubber-band) select (2026-07-07)

- **Drag on empty space in the select tool = a rubber-band selection.** The
  drag is detected in `DrawController`'s window listeners (same rig as
  click+drag); the rectangle is an HTML overlay in `EditorShell`
  (`MarqueeOverlay`), fed by transient `editorStore.marquee` (client px). On
  release, each member's screen polyline is hit-tested by the pure
  `design/marquee.ts` and `setSelection` replaces the selection.
- **CAD/SketchUp direction semantics:** drag **left→right = window** (select
  members fully **contained**, blue solid rect); drag **right→left = crossing**
  (select members that **touch**, green dashed rect). ⚠️ This is the *opposite*
  of the user's first phrasing ("from the left select touching") but matches
  their "same as SketchUp" — flagged for confirmation; it's a one-line flip in
  `marqueeFromDrag` if they want it reversed. Seam `__pvc.marquee(x0,y0,x1,y1)`.
- Multi-select highlights every matched pipe (PipeLayer already emissive-tints
  the whole selection set); the single-member gizmos/inspector act on
  `selectedIds[0]`.

## Rotate tool (2026-07-07)

- **Rotate tool: a 3-axis ring gizmo on the selected member.** Rings in the
  axis-triad colours (X red / Y green / Z blue) at the member's midpoint;
  dragging one turns the whole member (both endpoints + a formed pipe's control
  points) about that world axis through the midpoint, tracking the cursor's
  angle in the ring plane (free rotation, applied incrementally). `rotateMember`
  (pure Rodrigues rotation, tested — length/bends preserved); the drag rides the
  ring plane via `rayToPlane`. Click-to-select also works in the rotate tool.
  Seam `__pvc.rotateMember(id, axis, angleRad, pivot)`. Pillbox button (no
  hotkey — R is taken by reset-pivots).

## Drawing UX — click+drag, split snap toggles, 3D draw / Y-axis lock (2026-07-07)

- **Click+drag drawing** alongside two-click: press places the first point,
  drag, release places the end (path stays open to continue). The press+release
  is driven by **window** pointer listeners (not the mesh's own pointerup), the
  same reason the handle drags do — r3f drops a mesh pointerup once a drag moves
  the ray. Mesh pointermove still handles the between-clicks hover preview.
- **3D drawing / Shift-lock on any axis (incl. Y).** Once a path is open, the
  draw pointer rides a **view-facing plane** through the previous point
  (`dominantAxisNormal` + `rayToPlane`, like the endpoint drag) instead of the
  y = 0 ground — so in a side/front view you can draw up a wall, and Shift
  axis-lock now resolves to Y (it always considered Y; the ground target just
  never produced a vertical component). The FIRST point of a path still lands on
  the ground. Floor drawing in iso/top views is unchanged (the plane through a
  y = 0 point is the ground).
- **Snap toggles split** into **Snap to ends** (nodes) and **Snap along pipes**
  (on-pipe), independently switchable in the snap pill. `SnapContext` gained
  `pipeRadiusM` (falls back to `pointRadiusM`); the old combined `snapToPoints`
  pref migrates to both. Also: pointer handlers read the tool **live** from the
  store (a fresh tool switch can be a render ahead of the closure).
- **Shift perpendicular-to-previous (done):** `lockToNearestDirection` (pure,
  tested) locks a draw point to the nearest of the 3 world axes OR the direction
  perpendicular to the previous segment (nearest the cursor) — a right-angle turn
  in any plane, even when the run isn't world-aligned. `snapDrawPoint` feeds it
  the previous segment's perpendicular as an extra candidate.

## Render quality — hollow pipe ends, no junction ball, softer shadows (2026-07-07)

- **Pipes read as real tube with wall thickness.** `buildPipeModel` no longer
  emits a rounding **ball** at junctions (classified fittings / heat-wraps cover
  real joints); instead it emits a `PipeEnd` at every *free* (degree-1, non-wrap)
  pipe end, rendered as a recessed dark **bore** disc (radius = OD/2 − wall)
  inside the pipe's rim — so an open end shows the hole + wall. `orientZ` added
  for facing the disc down the pipe axis.
- **Softer shadows:** Canvas switched to `shadows="soft"` (PCFSoftShadowMap,
  which honours the light's `shadow-radius`) with `shadow-radius={6}`,
  `shadow-mapSize=2048`, and `shadow-normalBias={0.02}` to keep the blurred edge
  clean. (drei `SoftShadows`/PCSS was tried first but its shader calls
  `unpackRGBAToDepth` in a way three 0.185's shadow map rejects — broken shader,
  reverted.)

- **Move tool (M): a 3-axis translate gizmo on the selected member.** Arrows in
  the axis-triad colours (X red / Y green / Z blue) at the member's midpoint;
  dragging one slides the whole member (both endpoints, and a formed pipe's
  control points) along that world axis, grid-snapped, one undo step. The drag
  projects the cursor onto the axis via `closestAxisPointToRay` (pure, tested)
  so the **vertical Y arrow works** — a ground raycast can't give vertical
  motion. `translateMember` (pure, tested) does the shift; `useGroundDrag` grew
  a `project` option for the axis projection. Click-to-select also works in the
  move tool. Seam `__pvc.moveMember(id, delta)`.
- **Hotkeys: D = draw, B = bend (formed), M = move** (was B = draw, H = bend; H
  kept as a bend alias). Delete/Backspace (delete selection) and Esc/Enter or
  right-click (end a draw path) already existed — verified still working.

## Blender-style view-aware endpoint drag (2026-07-07)

- **Dragging an endpoint no longer snaps a floating node to the floor.** The
  endpoint grab previously raycast the fixed y = 0 ground plane, so any node
  above the ground was yanked down to y = 0. The free move now rides a
  view-facing plane fixed at grab time: `dominantAxisNormal` (pure, tested)
  picks the world axis most aligned with the camera's view direction as the
  plane normal, and `rayToPlane` intersects the cursor against that plane
  through the node's start point. Iso / top-down views → the **horizontal (Y)**
  plane, so the node keeps its height and slides in X/Z; a front/side view →
  a **vertical** plane, so the node can be moved up/down. A small Y bias
  resolves the iso view's exact three-axis tie toward horizontal (the common,
  ground-oriented case) and absorbs camera floating-point noise.
- **Scoped to the free (unlocked) move**; locked-mode pivot IK still targets the
  ground plane. On-ground nodes are unaffected (their horizontal plane *is* the
  ground). Shift axis-lock still applies on top. Verified in-browser: a floating
  pipe's endpoint drags horizontally with its height preserved exactly.

## Heat-wrapped tees (branch onto a pipe body) (2026-07-07)

- **A branch landing on a pipe's *body* (mid-span, not an end node) forms a
  heat-wrapped tee, not a socket-fitting split.** The run pipe stays **intact**;
  the branch end is (conceptually) heated, flattened, and wrapped around it.
  This is a new connection type — `wraps: Wrap[]` on the document (**schema v4**
  + migration `3→4` adds `wraps:[]`). `Wrap = { id, throughMember, branchNode,
  rigid, angleRad? }`; the branch node sits on the through pipe's centre-line.
- **Rigid (screwed) by default; switchable to a natural pivot.** `rigid: true` =
  flattened + screwed (a fixed joint); `rigid: false` = heat-wrapped revolute
  pivot whose axis is the through pipe's own direction. Toggled from the
  selection inspector (select the branch → Wrap: Screwed ⇄ Pivot) or
  `__pvc.setWrapRigid`. **Articulation of the pivot in the locked-length solver
  and Play-mode physics is deferred** (follow-up) — this pass ships the document
  model, the fabrication geometry, and the toggle.
- **Rendered as a flattened rectangular strip wrapped around the run**
  (`ui/scene/wrapMesh.ts`, pure + tested; `WrapLayer.tsx`): a round tube of
  circumference π·OD flattens to a strip ≈ π·OD/2 wide, modelled as a faceted
  band of flat boxes (14 facets over a 240° wrap) bent around the through
  cylinder — flattened PVC genuinely facets as it bends. Rigid wraps add two
  **screw discs**; a pivot wrap tints the strap toward the accent (the hinge
  barrel) and drops the screws. Placed at eased positions so it glides.
- **Wrap-joined members are exempt from the intersection (red-overlap) check** —
  a branch legitimately touches its through pipe, so that pair is skipped.
- **`splitMemberAt` (pure) is kept for the *future* fitting-type option.** Per
  the user: joint type will become configurable (rigid-wrap ⇄ pivot-wrap ⇄
  split + manufactured socket fitting), with the split option gated to angles
  where a real SCH 40 fitting exists (90°/45°). Not wired into the draw path
  yet; the wrap is the default interior-landing behaviour. Socket tees via an
  explicit shared-node join are unchanged.

## Interaction fixes — camera + length arrow (2026-07-07)

- **Projection toggle preserves the camera** (`state/cameraStore.ts`, a
  React-less module store like animStore). Toggling ortho ⇄ perspective still
  remounts OrbitControls (via `key={projection}`) so the controls rebind to the
  new default camera, but position/target/zoom now come from a shared pose:
  `CameraPoseSync` records the live pose on every controls `change`, and each
  camera mounts from it. **Scale is matched across the toggle** — ortho stores
  `zoom` directly; perspective converts its target distance into the equivalent
  ortho zoom (`visibleHeight = viewportH/zoom = 2·d·tan(fov/2)`), so switching
  doesn't jump apparent size. Verified in-browser: pan+rotate, toggle, camera
  target + view direction preserved (no reset to `[3.2,3.2,3.2]`/origin).
  New seam `__pvc.getCameraTarget()`.
- **Length arrow no longer jumps on first move.** The arrow head sits outward
  past the pipe end; the old drag set the length to the cursor's *absolute* axis
  projection, so grabbing the offset head snapped the length out to that larger
  value on frame one. Now `lengthFromGrabDrag` (pure, tested in `dragMath`)
  tracks the *delta* from the grab: at pointer-down `SelectionHandles` captures
  the pipe length + the cursor's axis projection, and each move applies
  `L0 + (projNow − grabProj)`, grid-snapped + clamped. `dragMemberEndLength`
  takes the captured `grab` offset.

## Phase 5 — BOM + examples + export/import + smoke (2026-07-07)

- **`bom(design)` is pure** (`design/bom.ts`): per-pipe cut length =
  centre-to-centre span − each end's fitting take-off; fitting counts by
  type + sizes (reducing flagged); formed pipes use developed length as the
  span + report the bend schedule; total pipe by size. Hand-rolled CSV.
- **Fitting take-off = max(0, centre-to-face − socket depth)**, with
  centre-to-face as **documented per-type ÷OD estimates** (elbow/tee/cross ≈
  1.2×OD, elbow45 ≈ 0.95×OD; couplings/reducers ≈ 0, butt at the centre). These
  are placeholders to replace with Spears/manufacturer SCH 40 take-off tables —
  the cut-list math is exact for whatever the constants are, and that's what the
  tests cover.
- **Export/import** reuse the Phase 0 `exportImport` (validate on the way out,
  migrate+validate on the way in). `importAndOpen` gives the imported design a
  fresh id so it never clobbers an existing project. `downloadFile` is a
  user-initiated client blob (no network). BomPanel offers CSV download.
- **Bundled examples** (generic subjects): Articulated arm (3 links + 2 pivots
  — pose it with the locked-length solver), Cube frame (12 pipes, corner
  conflicts flagged), and the earlier T-rex wireframe. Generated in
  `examples/generators.ts`.
- **Playwright smoke** (`e2e/smoke.spec.ts` + `playwright.config.ts`) runs
  against the **built** app via `window.__pvc` — draw → fittings → BOM → JSON
  round-trip (geometry byte-identical) → pivot 1-DOF, asserting a clean console.
  `e2e/` is excluded from Biome (browser globals + harness). `npm run e2e`
  builds + previews + drives chromium.

## Post-Phase-5 — CrashCat rigid-body physics (Play mode) (2026-07-07)

- **Added real physics via CrashCat (0.0.5), alongside the kinematic solver.**
  The Phase-4 kinematic `solve()` stays for *exact locked posing* (sliders set
  precise angles, drag IK, deterministic); the new `src/solver/physics.ts` is a
  *dynamic simulation* — pipes are dynamic capsules, welds are fixed
  constraints, pivots are hinge constraints with friction, gravity + an infinite
  static floor at y = 0. A **Play/Stop** toggle (`editorStore.simulating`) runs
  it; `GeometryAnimator` steps the world each frame and renders body positions
  (rebuild keyed by a topology hash). Play is a preview — the document isn't
  mutated; Stop reverts to the design.
- **Simulate at 20× scale.** Physics engines' contact slop is tuned for
  ~metre objects; PVC pipe is ~1 cm radius and sinks into the floor at true
  scale. The world is built at `SCALE = 20` (gravity scaled to match) and
  positions divided back — the geometry is engine-friendly and motion reads at
  real speed. Verified: a pipe drops and rests at ~radius on the floor, rigid
  links preserved, no explosion.
- **Why this also fixes closed loops:** a pivoted 4-bar (parallelogram) is a
  loop the tree-kinematic solver reports as over-locked / can't move; the
  physics solver handles it naturally. (The kinematic mobility readout is still
  spatial-Grübler and may mislabel planar loops — improving that is future work.)
- **Fixes bundled:** deleting a pipe now removes pivots that referenced it or a
  node it orphaned (no dangling pivots); a Reset-pivots button + **R** hotkey
  zeroes all pivot angles.

## Phase 4 — Pivots + locked-length physics (2026-07-07)

- **Physics is deterministic kinematics, not CrashCat.** CrashCat exists on npm
  but is v0.0.5 with untested determinism (the planfile flags this), and a
  locked-length revolute mechanism is *exactly solvable* — the acceptance is
  literally closed-form (arc / angle / length-preservation). So `solve()` is
  implemented as forward + inverse kinematics (`src/solver/kinematics.ts`),
  which is exact, deterministic, dependency-free, and satisfies every test. This
  **supersedes the Phase 0 decision** ("physics = CrashCat"); the planfile's own
  "trust the tests, not the engine" is the rationale. The pure `solve(design,
  inputs, mode)` boundary is exactly as pinned (no engine/UI types cross it).
- **Solver model:** welded members → rigid bodies (union-find; a pivot node is
  not welded across), pivots → revolute joints, forward kinematics over a
  rooted body tree/forest (rigid transforms ⇒ lengths preserved by
  construction), drag → cyclic-coordinate-descent IK over the path pivots,
  writing resolved angles back so the sliders track a drag. Grübler-style
  spatial mobility `6(B−1) − 5J` per component + over-constrained (loop)
  readout. `SolveResult` adds `pivotAngles` (an extension) for drag→slider sync.
- **Pivot** = `{ nodeId, memberA, memberB, axis, angleRad?, limits? }` (schema
  v3 + migration adding `pivots:[]`). Default axis = joint-plane normal
  (`cross(dirA, dirB)`), so rotating opens/closes the bend. Pivot nodes are
  exempt from fitting resolution.
- **Locked-mode integration:** `GeometryAnimator` eases toward *solved*
  positions when `lengthsLocked && pivots.length` (else document positions), so
  every layer that reads the eased map (pipe, fittings, handles) follows the
  mechanism for free. `PivotPanel` shows the mobility badge + an angle slider
  per pivot; endpoint drag switches from length-edit to IK drag-to-rotate;
  `PivotLayer` draws a hinge glyph and click-to-create markers for the Pivot
  tool.

## Phase 3 — Formed (spline) pipe + intersections (2026-07-07)

- **`formed` member = a Catmull-Rom spline** through nodeA → controlPoints →
  nodeB, with optional per-bend `filletRadiiM` (schema v2 + identity migration).
  Control points are stored on the member (not nodes); endpoints are nodes so a
  formed pipe can plug into a junction (`addFormedMember` reuses an existing
  node at the endpoint position).
- **Analysis is pure and reuses `geometry/pipe.ts`** (`design/formed.ts`):
  developed centre-line length (filleted), bend schedule (deflection +
  fabrication dihedral), and a min-bend-radius check (OD × 3 estimate). The
  developed length is verified against the analytic fillet formula.
- **Intersection highlighting is a pure capsule test** (`design/intersections.ts`,
  Ericson segment-segment distance), excluding members that share a node
  (legitimate joints). Rendered as an enlarged translucent-red shell over the
  offending pipe; skipped past 200 members.
- **Formed tool** accumulates ground clicks in `editorStore.formedPoints`,
  previews a live ghost spline tube, and commits one formed member on
  finish (Enter / right-click; ≥2 points). Each bend defaults to the min
  heat-form radius. Rendered with `TubeGeometry` along a `CatmullRomCurve3` at
  true OD (`FormedLayer`), eased like straight pipe.
- **Rendering split:** `pipeModel`/PipeLayer handle straight cylinders + all
  joints; formed bodies are tubes in FormedLayer; fitting end-tangents at a
  formed endpoint come from the first/last spline segment. SelectionHandles
  (length arrows) stay straight-only; the SelectionPanel shows a formed pipe's
  developed length + bend count + a tight-bend warning instead.

## Phase 2 — Fitting auto-solve + procedural meshes (2026-07-07)

- **`resolveFittings(design)` is pure and the single source of fitting truth**
  (`design/fittings.ts`) — no three/UI/physics types. Per node it gathers
  incident pipe ends (outgoing unit dir + size) and classifies within a ±3°
  tolerance: coupling/reducer (collinear same/mixed size), 90°/45° elbow, tee
  (collinear run + perpendicular branch, reducing if the branch differs), cross
  (two perpendicular runs); everything else is a **conflict** with a reason.
  Open ends get no auto fitting (caps are opt-in, not applied). Exhaustively
  tested.
- **Elbows are same-size only** (mixed → conflict); tees/crosses allow a
  reducing branch/leg. Reducer take-off dimensions (centre-to-face) are NOT yet
  in `PipeSpec` — added in Phase 5 for the BOM; meshes use proportional sizing.
- **Fitting meshes are procedural + composed** (`ui/scene/fittingMesh.ts`, the
  CAD-swap seam): each incident end → a socket hub (sleeve 1.28× pipe OD) + a
  bell lip; elbows/tees/crosses add a blend sphere. Pure/tested (primitive
  counts + radii). `FittingLayer` renders them in fitting-gray and marks
  conflicts with a translucent red sphere.
- **Types from the doc, geometry from eased positions.** FittingLayer takes the
  fitting TYPE from the snapped document (stable — no flicker mid-drag) but
  recomputes each fitting's position + end directions from the eased render
  positions, so fittings glide with the pipe. Skipped entirely past 200 members
  (the T-rex wireframe stays connector-free).

## Phase 1 — interaction polish (2026-07-07)

- **Snapping is configurable via a floating pill** (`SnapPill`, bottom-left):
  grid increment (default **1/4"**, plus 1/8"/1/2"/1"/Off; metric equivalents
  when the design is metric) and toggles for point-snap and axis-inference. It's
  a **workspace preference** in `editorStore.snap`, persisted to localStorage
  (`prefs`), never in the document. `editorActions` derives all snap tolerances
  from it. `DEFAULT_GRID_M` lives in `design/snapping.ts`.
- **Geometry eases toward snapped positions** (`state/animStore.ts` +
  `<GeometryAnimator/>`): editing writes stepped/snapped node positions to the
  doc, and the viewport shows positions that lerp toward them (~45 ms), so a
  fine grid glides instead of jumping. New nodes snap in place (no fly-in);
  designs over 160 nodes skip easing (the T-rex renders at target, no per-frame
  cost). `buildPipeModel` takes an optional eased-position override; PipeLayer +
  SelectionHandles read the eased map and re-render off an anim tick.
- **Control scheme:** left button is reserved for tools + a future selection
  marquee (never orbits); **middle = pan, right = free rotate** (OrbitControls
  `mouseButtons`), context menu suppressed. **Spacebar → select tool**;
  **right-click ends the current path** (right-drag still rotates). **Shift while
  drawing locks to the nearest world axis from the path start** (forced, beyond
  proximity inference).
- **Velocity-aware wheel zoom** (`<VelocityZoom/>`): a capture-phase wheel
  listener measures wheel speed (smoothed magnitude/ms) and sets
  OrbitControls' `zoomSpeed` before it handles the same event, so a fast flick
  covers ground and a slow scroll stays fine. Verified: same total delta, fast
  ≈1.9× vs slow ≈1.45× zoom.
- **Deferred:** SketchUp-style reference inference — hover a feature to seed
  extra inference directions (from-point axes, parallel/perpendicular) — is not
  built yet; only the basic Shift axis-lock is. Revisit alongside richer
  drawing.

## Phase 1 — Draw straight pipe + realistic render (2026-07-07)

- **Editing is pure `Design → Design` docOps** (`src/design/docOps.ts`) applied
  through `appStore.updateCurrent`, so undo/autosave stay centralized. Nodes are
  shared junctions: dragging a node moves every incident member; `deleteMember`
  prunes only the nodes it orphans.
- **Snapping is one pure function** (`src/design/snapping.ts`) with a fixed
  priority: existing node → on-pipe point → axis inference from the path start →
  world grid → free. Axis inference grid-quantizes the length *along* the locked
  axis (so on-axis draws land on exact dimensions). Tolerances are world-metre
  (1" grid, 20 mm point radius, 30 mm axis corridor) — good enough at rig scale;
  screen-space tolerances can come later if zoom range demands it.
- **The tools and the `__pvc` hook call ONE action layer**
  (`src/state/editorActions.ts`): `placeDrawPoint` / `dragNodeTo` / `snapDraw…`
  bridge snapping + docOps + stores, so a scripted check drives exactly what the
  pointer drives. New seams: `draw`, `snap`, `finishPath`, `selectMember`,
  `clearSelection`, `setMemberLength`, `dragNode`, `getMembers`, `setDrawSize`.
- **Ground-plane interaction model.** Drawing and dragging both raycast the
  y = 0 plane (`rayToGround`); node centrelines live on the grid plane. A single
  full-bleed plane in `DrawController` doubles as the pointer target and the
  shadow catcher.
- **Shadows via a shadow-map + `shadowMaterial` catcher, not drei
  `ContactShadows`.** A coincident invisible picker plane confuses
  ContactShadows' whole-scene depth pass; a `shadowMaterial` ground plane only
  renders shadowed fragments, so it grounds the pipe *and* is a clean r3f pointer
  target. Still no network (drei `Environment` presets remain out — Phase 0).
- **Click vs orbit-drag** is disambiguated by pointer travel (< 6 px screen =
  place a point; more = the OrbitControls drag). Endpoint drags suspend
  OrbitControls and batch into one undo step via `begin/endGesture`.
- **Direct-manipulation resize (revised):** a selected pipe shows two kinds of
  handles at each end — an outward **length arrow** (cone) that resizes along
  the pipe's own axis (opposite end fixed, grid-snapped, live label), and an
  **endpoint grab sphere** that free-moves the junction on the ground, with
  **Shift to lock to a world axis**. The drag math is pure/tested
  (`design/dragMath.ts`: `projectLengthOnAxis`, `lockToNearestAxis`); the
  numeric length field stays as the precise alternative.
- **Handle drags use window pointer listeners, not mesh events.** r3f only
  sends a mesh pointermove/up while the ray intersects it, so a mesh-driven drag
  stopped — and its "re-enable OrbitControls" pointerup never fired — the moment
  the cursor left the small handle, leaving the camera stuck (and fighting a
  leftover `setPointerCapture`). `useGroundDrag` (SelectionHandles) now suspends
  OrbitControls on pointer-down and drives move/up from `window` listeners
  (raycasting the ground each move), guaranteeing the pointer-up re-enables
  controls anywhere. No `setPointerCapture`.
- **Bundled examples + a mesh-import path.** `src/examples/` holds baked Design
  JSON offered from the project list (`appStore.createFromExample`). The first
  is a **T-rex wireframe** — a low-poly STL turned into pipe by
  `scripts/gen-trex.mjs` (edges → straight members, vertices → nodes, welded;
  remapped Z-up→Y-up, rested on the ground, scaled to ~1.8 m; no fittings). It
  doubles as a render stress test (262 nodes / 780 pipes). Generated JSON +
  one-off scripts are excluded from Biome.
- **Drag performance:** the scene graph must not re-render on every drag frame.
  `Scene` does NOT subscribe to the document; `PipeLayer`/`SelectionHandles`/
  `DrawController` read it (or narrow slices) themselves, and `EditorShell`
  subscribes to fields (name/lengthsLocked), so a drag only re-renders the pipe
  + handle layers, not the grid/gizmo/cameras/lights. Shadow map is 1024² and
  the Canvas uses `shadows="percentage"` (PCFShadowMap) — avoids three 0.185's
  `PCFSoftShadowMap` deprecation warning and is cheaper. (The remaining
  `THREE.Clock` deprecation is emitted inside @react-three/fiber's loop, not our
  code.)
- **Pipe material** is `meshPhysicalMaterial` (white PVC, roughness 0.38, faint
  clearcoat). Cylinders at true OD from `PipeSpec`; a rounding sphere at each
  junction sized to the thickest incident member.
- **Pillbox = tool (select/draw) + active draw size.** The two size buttons pick
  the active `drawSize` (editor state); `design.enabledSizes` stays both.
  Keyboard: V/B tools, Esc/Enter finish path, Delete removes selection, ⌘/Ctrl+Z
  undo.

**State at end of Phase 1:** typecheck / lint / **73 unit+integration tests** /
build all green; a headless-chromium smoke against the built app confirms the
WebGL scene mounts, a 3-pipe path drawn through `__pvc` preserves segment
lengths within 1e-6 m at correct OD, length-edit + selection + perspective
toggle work, and the console/network is error-free.

## Phase 0 — Scaffold & stack (2026-07-07)

Already-made decisions carried in from the planfile (§10), recorded here at the
first commit as instructed:

- **Renderer = three.js + @react-three/fiber + @react-three/drei** (over
  Babylon / PlayCanvas): React-first ergonomics and reuse of riglab's rendering
  approach. drei supplies the camera/orbit/grid/gizmo primitives.
- **Physics = CrashCat behind the `solve()` boundary** (arriving Phase 4). Its
  determinism is untested upstream, so pivot math will be acceptance-tested
  against closed-form (arc/angle/length-preservation), not trusted from the
  engine. Not yet a dependency — added when Phase 4 lands.
- **Fittings = procedural from ASTM dimensions** (`PipeSpec` table), with a
  `FittingMesh` seam left for swapping in real CAD later; not built in v1.
- **Mixed 1/2" + 3/4" allowed**, resolving to auto reducer fittings (Phase 2).
- **Pivots driven by both drag and angle sliders** (Phase 4).

Scaffold-specific decisions:

- **Stack mirrors riglab with pinned exact versions** (React 19.2, Vite 8.1,
  TS 6.0, Biome 2.5, Tailwind v4, three 0.185, zustand 5 + zundo + immer, Zod 4,
  Dexie 4). Config (`tsconfig`, `vite.config`, `biome.json`, `components.json`,
  shadcn token block in `index.css`) copied and adapted. Pure math
  (`geometry/math3.ts`, `geometry/pipe.ts`) and `ui/units.ts` copied **verbatim
  with their tests**.
- **riglab-only deps dropped**: konva/react-konva (riglab's 2D sketch canvas —
  PVC Builder is 3D-only), planck/rapier (riglab's physics — replaced by
  CrashCat later). Added: three + @react-three/fiber + @react-three/drei +
  @types/three.
- **Design schema v1 = nodes + straight members only** (planfile phasing).
  Formed (spline) members land Phase 3 and pivots Phase 4, each as a
  `SCHEMA_VERSION` bump + migration. The migration registry is empty at v1; the
  runner (`applyMigrations`/`migrateToLatest`, copied from riglab) is already
  covered by tests so the first real migration has a proven harness.
- **`PipeSpec` seeded with OD / wall / socket depth only** for 1/2" and 3/4"
  (ASTM D1785 / D2466). Elbow/tee/cross centre-to-face take-offs are left
  optional and filled in Phase 2 from Spears tables rather than fabricated now.
- **No `Environment` IBL preset in the viewport.** drei's `Environment` presets
  fetch an HDR over the network; the planfile forbids runtime network. Phase 0
  uses ambient + hemisphere + directional lights. A local/bundled IBL can be
  added in Phase 1 if the plastic look needs it.
- **Theme kept lean.** riglab's large `theme.ts` chrome-token system is not
  copied; `ui/theme.ts` only toggles the shadcn `.dark` class and exposes a
  small `scenePalette()` for the three.js-side colors (which can't read CSS
  vars).
- **Playwright deferred to Phase 5.** The `e2e` script and `@playwright/test`
  dep are present, but no config/tests yet (planfile puts the smoke suite in
  Phase 5). Phase 0 verification is Vitest + a served-build HTTP smoke.
- **Debug hook is `window.__pvc`** (merge-not-replace), exposing `getDoc`,
  `getEditor`, `setTool`, `setProjection`, `setLengthsLocked`, `setNight` so
  far; more seams (`resolveFittings`, `getSolve`, `loadExample`, …) are added as
  their phases land.

**State at end of Phase 0:** `typecheck`, `lint`, `test` (41 passing), and
`build` all green; the built app serves and mounts; create/open/rename/delete a
design through the Dexie-backed store (covered by tests); 3D viewport renders an
iso ortho stage with ground grid + axis gizmo and a one-click perspective
toggle; `window.__pvc.getDoc()` installed.
