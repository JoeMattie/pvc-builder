# src/design — pure domain logic (the tested core)

Pure `Design → Design` transforms and pure analyses. **No three.js / React / store types
cross any boundary here.** This is the primary Vitest surface — every file has a `.test.ts`
companion. Mutations never mutate inputs; they return new documents (or `{design, id}`),
applied elsewhere via `appStore.updateCurrent` for undo/autosave.

`docOps.ts` is the hub: `bom`, `fittings`, `formed`, `intersections` all import lookups
(mostly `nodeById`) from it.

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `docOps.ts` (518) | Core editing API — nodes, members, path drawing, move/rotate/split/delete, and the whole **joints** subsystem | lookups (`nodeById`, `memberEndpoints`, `memberLengthM`, `throughMemberAt`, `nodeDegrees`); mutations (`addMember`, `startPath`, `appendPipe`, `setNodePosition`, `translateMember`, `rotateMember`, `setMemberLengthM`, `splitMemberAt`, `deleteMember`); joints (`joinContext`, `setJoinMode`, `addBodyJoint`, `healBodyJoints`, `reconcileBodyJoints`, `removeJoint`, `swapReceiver`, `setJointAngle`, `setJointOrientation`, `resetJoints`, `jointsAtNode`) |
| `fittings.ts` (188) | **Core feature.** Classify each node's incident pipe ends → coupling/reducer/elbow45/elbow90/elbow3way/tee/cross or conflict | `resolveFittings(design): FittingResolution`, `incidentEnds`, `FittingType`, `ANGLE_TOL_DEG=3` |
| `bom.ts` (206) | Cut-list / BOM — per-pipe cut length, fitting + joint hardware counts, totals, CSV | `bom(design): Bom`, `bomToCsv`, `fittingTakeoffM`, `EYE_BOLT_TAKEOFF_M` |
| `formed.ts` (74) | Heat-bent pipe analysis — developed length, bend schedule, min-bend-radius | `formedPoints`, `analyzeFormed`, `MIN_BEND_RADIUS_FACTOR=3` |
| `snapping.ts` (150) | SketchUp-style draw inference + snapping (node → on-pipe → axis → grid → free priority) | `snapPoint(raw, ctx)`, `closestPointOnSegment`, `planeCardinalFromCursor` (draw-on-plane wall angle: world + pipe-relative cardinals), `DEFAULT_GRID_M` (¼") |
| `dragMath.ts` (138) | Direct-manipulation drag math — axial length resize, axis-locked moves | `projectLengthOnAxis`, `lengthFromGrabDrag`, `closestAxisPointToRay`, `lockToNearestDirection` |
| `intersections.ts` (137) | Flag overlapping pipe volumes (capsule-vs-capsule) | `intersectingMembers(design): Set<string>`, `segmentSegmentDistSq` |
| `marquee.ts` (93) | Screen-space rubber-band hit-testing (window/crossing CAD semantics) | `marqueeFromDrag`, `memberSelectedBy`, `segmentsIntersect` |
| `ids.ts` (5) | Short prefixed id generator | `makeId(prefix)` → `${prefix}-${8 hex}` |

## Depends on
`../geometry/math3`, `../geometry/pipe`, `../schema`. **Exception:** `bom.ts` also imports
`../ui/units` (`formatLength`) — the only design→ui edge; keep it that way.

## Read before editing
- **`setJoinMode`**: an end-to-end `anchor` is the DEFAULT rigid coupling and stores **no** joint
  record (it removes any existing one). Joints only exist for wrapped/free, or on-body branches.
  It preserves `angleRad`/`limits`/`orientation` across compatible mode changes and returns the
  design unchanged when the mode doesn't fit the geometry.
- **`translateMember` / `rotateMember` must also move a formed member's `controlPoints`**, or
  lengths/bends break.
- **`setMemberLengthM` / `splitMemberAt` are straight-only** (formed length is derived).
- **`deleteMember` prunes orphaned nodes AND joints** referencing the deleted member — no dangling joints.
- **`resolveFittings` skips any node carrying a joint** — the joint hardware IS its fitting.
  elbow45 is detected at 135° between outgoing dirs. 5+ ends = conflict.
- **BOM take-off constants (`CENTRE_TO_FACE_FACTOR`, `EYE_BOLT_TAKEOFF_M`) are documented
  estimates** to replace with manufacturer tables. Math is exact for whatever constants are set.
- **`snapping.ts` priority order is UX** — changing node→on-pipe→axis→grid order changes feel.
- **`intersections.ts` `segmentSegmentDistSq`** is the Ericson RTCD closest-segment algorithm —
  subtle branch logic; don't refactor casually. Pairs sharing a node or joined by a joint are excluded.

_Update this file when you add/rename a file here or change a joint/fitting invariant._
