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
| `docOps.ts` (518) | Core editing API — nodes, members, path drawing, move/rotate/split/delete, the whole **joints** subsystem, plus measurements / groups / **elastics** | lookups (`nodeById`, `memberEndpoints`, `memberLengthM`, `throughMemberAt`, `nodeDegrees`); mutations (`addMember`, `startPath`, `appendPipe`, `setNodePosition`, `translateMember`/`rotateMember` = single, **`translateMembers`/`rotateMembers` = rigid-body multi (each shared node moved ONCE — the group anti-skew path)**, `setMemberLengthM`, `splitMemberAt`, `deleteMember`); joints (`joinContext`, `setJoinMode`, `addBodyJoint`, `healBodyJoints`, `reconcileBodyJoints`, `removeJoint`, `swapReceiver`, `setJointAngle`, `setJointOrientation`, `resetJoints`, `jointsAtNode`); groups (`groupMembers`, `ungroupMembers`, `groupColorOf`/`setGroupColor`, `groupOfMember`, `GROUP_PALETTE`); elastics (`addElastic`, `removeElastic`, `setElasticStiffness`, `attachmentPos`, `elasticLengthM`) |
| `fittings.ts` (188) | **Core feature.** Classify each node's incident pipe ends → coupling/reducer/elbow45/elbow90/elbow3way/tee/cross or conflict | `resolveFittings(design): FittingResolution`, `incidentEnds`, `FittingType`, `ANGLE_TOL_DEG=3` |
| `bom.ts` (206) | Cut-list / BOM — per-pipe cut length, fitting + joint hardware counts, totals, CSV | `bom(design): Bom` (incl. `stock` 10-ft purchase list), `bomToCsv`, `stockNeeds` (FFD bin packing), `STOCK_LENGTH_M`, `fittingTakeoffM`, `EYE_BOLT_TAKEOFF_M` |
| `formed.ts` (74) | Heat-bent pipe analysis — developed length, bend schedule, min-bend-radius | `formedPoints`, `analyzeFormed`, `MIN_BEND_RADIUS_FACTOR=3` |
| `snapping.ts` (150) | SketchUp-style draw inference + snapping (node → on-pipe → axis → grid → free priority) | `snapPoint(raw, ctx)`, `closestPointOnSegment`, `planeCardinalFromCursor` (draw-on-plane wall angle: world + pipe-relative cardinals), `DEFAULT_GRID_M` (¼") |
| `dragMath.ts` (138) | Direct-manipulation drag math — axial length resize, axis-locked moves | `projectLengthOnAxis`, `lengthFromGrabDrag`, `closestAxisPointToRay`, `lockToNearestDirection` |
| `intersections.ts` | Flag overlapping pipe volumes (capsule-vs-capsule) | `intersectingMembers(design): Set<string>`, `intersectingStraightPairs` (straight×straight crossings + closest-approach params/points), `segmentSegmentClosest`/`segmentSegmentDistSq`, `pairKey` |
| `solveIntersections.ts` | Auto-fix red warnings, TWO passes. Pass 1 (overlaps): crossings CLUSTERED by point, every pipe of a cluster joins ONE node — ends weld in, throughs take on-body `anchor` records while free movers last, the rest are cut at the node. Pass 2 (junction conflicts): a recordless 2-end NONSTANDARD corner merges into ONE formed member bent at the junction (heat-bent corner → BOM developed length; standard corners never conflict and keep their fittings); 3+ ends with no standard fitting get per-mover end-to-end `anchor` records (the brown hub). Formed-spline overlaps out of scope. Idempotent | `solveIntersections(design): {design, joined}` |
| `extend.ts` | Extend (push) tool geometry — the directions you can draw a new pipe out of an end | `extendDirections(design, nodeId)` (6 axes + continuations opposite incident pipes, minus dirs along an existing pipe), `incidentDirsAt`, `endSizeAt` |
| `guides.ts` | Construction guide-line geometry (transient Q-tool aids, NOT in the doc) | `Guide`/`GuideSegment`, `snapDirToAxis`, `guideIntersections` (line∩segment), `perpOffsetM`/`perpUnit`, `guideDrawSpan` |
| `marquee.ts` (93) | Screen-space rubber-band hit-testing (window/crossing CAD semantics) | `marqueeFromDrag`, `memberSelectedBy`, `segmentsIntersect` |
| `ids.ts` (5) | Short prefixed id generator | `makeId(prefix)` → `${prefix}-${8 hex}` |
| `mannequin.ts` | Pure geometry of the static human collision/render body (v9-introduced doc flag, current schema v10) — the SHARED COORDINATE CONTRACT | `mannequinShapes(): MannequinShape[]` (`sphere`\|`capsule`\|`box` union at contract coords), `MANNEQUIN_ANCHORS` (named mount points: shoulder saddles `(±0.23,1.45,0)`, hip pivots `(±0.20,1.00,0)`, neck/tail roots, head center) |

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
- **`deleteMember` prunes orphaned nodes AND joints AND elastics** referencing the deleted member — no
  dangling joints/bands. An elastic's `attachmentPos({memberId,t})` lerps the member's two node
  positions (straight only); `{nodeId}` returns the node position.
- **`resolveFittings` skips any node carrying a joint** — the joint hardware IS its fitting.
  elbow45 is detected at 135° between outgoing dirs. 5+ ends = conflict.
- **BOM take-off constants (`CENTRE_TO_FACE_FACTOR`, `EYE_BOLT_TAKEOFF_M`) are documented
  estimates** to replace with manufacturer tables. Math is exact for whatever constants are set.
- **`snapping.ts` priority order is UX** — changing node→corner→on-pipe→axis→grid order changes
  feel. `corners` (formed members' bend control points, kind `'corner'`) snap like ends
  (`pointRadiusM`) but are geometry only — no nodeId, nothing joins.
- **`intersections.ts` `segmentSegmentClosest`** is the Ericson RTCD closest-segment algorithm —
  subtle branch logic; don't refactor casually. Pairs sharing a node are excluded, and so is the
  whole CLUSTER at a joint's node (the joint's mover + receiver + every member incident to that
  node — e.g. both halves of a split run vs the through pipe).
- **`addBodyJoint` picks the first incident member WITHOUT a joint at the node as mover** (so a
  further pipe joined at the same junction records on a free mover) and refuses when the receiver
  already participates in any joint at that node. `solveIntersections` relies on both, and places
  every junction node EXACTLY on the receiver's centre-line (within the exported
  `ON_BODY_KEEP_TOL_M`) so `reconcileBodyJoints` keeps its unions.

_Update this file when you add/rename a file here or change a joint/fitting invariant._
