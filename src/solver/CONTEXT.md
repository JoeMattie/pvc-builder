# src/solver — kinematics behind solve(), plus the CrashCat physics subsystem

Two separate subsystems. **`solve()` is the pure boundary** (§5): no three/UI/engine types cross
it. `physics.ts` is a parallel stateful subsystem (the external `crashcat` engine) reached
directly by the UI for Play mode — it is intentionally OUTSIDE the `solve()` contract.

There is **no `crashcat/` subdirectory** — `crashcat` is the npm package `crashcat@0.0.5`.

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `index.ts` (82) | The `solve()` façade (§5) | `solve(design, inputs: SolveInputs, mode: 'pose'): SolveResult`, `SolveMode`, `SolveInputs`, `SolveResult` |
| `kinematics.ts` (643) | Deterministic FK + IK behind the boundary | `solvePose(design, inputs): PoseResult`, `Transform`, `PoseResult` (everything else module-private) |
| `physics.ts` | CrashCat rigid-body sim for Play mode (**outside** solve()) | `startPhysics`, `stopPhysics`, `stepPhysics(dt)`, `physicsActive`, `physicsWorld` (debug renderer), `physicsNodePositions`, `physicsFormedControlPoints`, `physicsTopoHash`, `simGroundY`, `lowestExtentM`, `PHYSICS_SCALE`, `setPhysicsPrecision`, `setPhysicsTuning` |

## Depends on
`index.ts` → `../schema` (types only), `./kinematics`. `kinematics.ts` → `../geometry/math3`,
`../schema`. `physics.ts` → `crashcat`, `crashcat/three` (debug renderer, via `ui/scene/PhysicsDebug`),
`mathcat` (allocation-free `physicsNodePositions` hot path), `../geometry/math3`, `../schema`,
`../design/mannequin` (pure shapes for the static mannequin body).

## What solve() actually does
- **Unlocked (`lengthsLocked:false`) is NOT physics** — returns node positions verbatim (identity).
- **Locked** delegates to `solvePose`: union-find welds members into rigid bodies (a wrapped
  joint's *mover* is excluded from the weld; on-body anchors weld branch→run); FK by BFS;
  wrapped joint = 1-DOF revolute about the receiver's own axis, free joint = 3-DOF orientation.
- **Drag IK**: trees use CCD (`ccd`, 24 iters); closed loops use damped Levenberg-Marquardt
  (`solveLoops`, numeric Jacobian) — *iterative*, not algebraically closed-form. Loop closure is
  what keeps member lengths exact around a cycle.
- **Mobility**: Grübler count (planar special-case when all-wrapped + parallel axes, else spatial).

## Read before editing
- **Purity rule**: no three/UI/`crashcat` types in `solve()`'s interface. Only `Design`/`Vec3`/`Quaternion` cross.
- **Rigid transforms guarantee exact member-length preservation regardless of IK convergence** —
  this is the core §5 promise. **Trust the tests (`solver.test.ts`), not the engine.**
- **`SolveResult.pivotAngles`/`jointOrientations`** extend the planfile shape: drag IK writes
  resolved angles/orientations back so sliders track a drag.
- **`diagnostics.conflicts` is always `[]`** (vestigial placeholder).
- **`physics.ts` gotchas**: everything simulated at `SCALE=20` (PVC is ~1cm); each welded assembly
  = one `staticCompound` mirroring the kinematics union-find; pipe-vs-pipe collisions disabled
  (pipes only hit the ground); floor lowered to `simGroundY` at sim start so nothing erupts;
  fixed-substep + CCD stops thin pipes tunnelling. Mutable module-level `sim` state.
  Formed members' bend `controlPoints` (absolute world coords in the doc) get body-local offsets at
  `build()` (like `nodeSource`) and read back live via `physicsFormedControlPoints()` (memberId →
  world Vec3[]) — so bends ride their rigid body; on stop it returns `{}` and renderers revert to
  the doc (nothing is written back, same as node positions).
- **Elastic bands** (schema v8): resolved at `build()` to `SimElastic{aBody,aLocal,bBody,bLocal,
  restLenScaled,kScaled}` reusing the `nodeSource` body+local-offset mapping (a `{memberId,t}` end is
  lerped in world space then folded into that member's assembly body local frame via `bodyRest`).
  `applyElasticForces()` runs at the TOP of `stepPhysics` (before `updateWorld`): a stretched band
  applies `F = kScaled·stretch + ELASTIC_DAMPING·vRelAxial` at each end (`±F·dir`; STATIC/missing
  bodies skipped; bands only PULL). `kScaled = stiffnessNPerM · ELASTIC_K_SCALE` (`=SCALE²·3`, TUNED —
  softer than the physically-exact SCALE³ to stay stable at 60 fps). `physicsTopoHash` includes
  `elastics` so the sim rebuilds on add/remove/retension.
- **Mannequin + damping** (v9-introduced fields in current schema v10): when `design.mannequin`, `build()` adds ONE STATIC
  `staticCompound` of the scaled `mannequinShapes()` on the existing `olStatic` layer (moving pipes
  already collide with `olStatic`, like the ground) so the model hangs on the human body instead of the
  floor. `const damping = design.jointDamping ?? 1` MULTIPLIES the wrapped-pivot `SLIDE_FRICTION_FORCE`/
  `PIVOT_FRICTION_TORQUE` (in the sixDOF `maxFriction`) and the per-frame elastic `ELASTIC_DAMPING` (via
  `sim.damping`) — identical at 1.0. Both feed `physicsTopoHash` (toggling rebuilds). NOTE: in the
  slider's 0.2–5× range the pivot friction is negligible vs gravity, so damping's observable effect is
  the elastic path (see `physics.test.ts`).

## Tests
- `solver.test.ts` — analytic acceptance: single pivot arc, drag-on-circle, ball-joint sphere,
  zig-zag chain, closed square loop (mobility −2, over-constrained, lengths held), determinism.
- `physics.test.ts` — behavioral: free pipe falls & settles on floor, welded L stays rigid, no
  eruption/tunnelling; `lowestExtentM`/`simGroundY` helpers.

_Update this file if the solve() interface or the physics/kinematics split changes._
