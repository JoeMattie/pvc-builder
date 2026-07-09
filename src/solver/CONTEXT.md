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
| `physics.ts` | CrashCat rigid-body sim for Play mode (**outside** solve()) | `startPhysics`, `stopPhysics`, `stepPhysics(dt)`, `physicsActive`, `physicsWorld` (debug renderer), `physicsNodePositions`, `physicsTopoHash`, `simGroundY`, `lowestExtentM`, `PHYSICS_SCALE`, `setPhysicsPrecision`, `setPhysicsTuning` |

## Depends on
`index.ts` → `../schema` (types only), `./kinematics`. `kinematics.ts` → `../geometry/math3`,
`../schema`. `physics.ts` → `crashcat`, `crashcat/three` (debug renderer, via `ui/scene/PhysicsDebug`),
`mathcat` (allocation-free `physicsNodePositions` hot path), `../geometry/math3`, `../schema`.

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

## Tests
- `solver.test.ts` — analytic acceptance: single pivot arc, drag-on-circle, ball-joint sphere,
  zig-zag chain, closed square loop (mobility −2, over-constrained, lengths held), determinism.
- `physics.test.ts` — behavioral: free pipe falls & settles on floor, welded L stays rigid, no
  eruption/tunnelling; `lowestExtentM`/`simGroundY` helpers.

_Update this file if the solve() interface or the physics/kinematics split changes._
