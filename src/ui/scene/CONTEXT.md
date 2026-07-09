# src/ui/scene — three.js / react-three-fiber rendering layer

The impure 3D layer. **Pure mesh-builder modules (the CAD-swap seams) are unit-tested; the R3F
`.tsx` components are not** (untestable without WebGL — the deliberate split, logic lives in the
pure modules). Positions everywhere come from `easedPos(id) ?? nodeById(...).position` so meshes
glide on snaps — never raw doc positions.

## Pure / testable modules (the CAD-swap seams + math)

| File | Responsibility | Key exports |
|---|---|---|
| `pipeModel.ts` | `Design` → flat solid primitives (one cylinder per straight member at true OD, hollow bore at free ends) | `buildPipeModel(design, posOf?)`, `PipeModel`/`PipeCylinder`/`PipeEnd`, `FREE_JOINT_GAP_M` |
| `fittingMesh.ts` | **`FittingMesh` CAD-swap seam** — procedural socket fittings from `pipeSpec` | `buildFittingMesh(f)`, `buildFittingMeshes`, `FittingMesh`/`FittingPrim` |
| `wrapMesh.ts` | Mirror seam for heat-wrapped slip-saddle tees (collar+boss+blend+screws) | `buildWrapMesh(inp): WrapMesh \| null`, `WrapMesh`/`WrapInput` |
| `ground.ts` | Raycasting helpers | `rayToGround`, `rayToPlane`, `dominantAxisNormal` |
| `pipePick.ts` | Screen-space snap: nearest node/pipe under the cursor (draw + endpoint drag, any height) | `pickSnapPoint`, `SNAP_PX`, `snapDebug` |
| `axis.ts` | Place a unit-Y primitive along a segment (from riglab) | `placeAxis(a,b)`, `orientY(dir)`, `orientZ(dir)` |
| `instancing.ts` | Compose per-instance matrices for `InstancedMesh` from UNIT base geometry (radius/height 1) | `cylinderMatrix(out,a,b,r)`, `sphereMatrix`, `ringMatrix`, `coneMatrix`, `wrapFrameMatrix` (joint-local basis), `hideMatrix` |

## Impure R3F components

| File | Responsibility | Notes |
|---|---|---|
| `Viewport.tsx` | The `<Canvas>` host | soft shadows, wraps `<Scene>` |
| `Scene.tsx` (mod) | Composes everything: cameras, lights, layers, gizmos, headless drivers | **does NOT subscribe to the doc** — each layer subscribes itself |
| `PipeLayer.tsx` (mod) | Straight pipe bodies as ONE `InstancedMesh` + INSTANCED bores + end-cap ghosts (`PipeDecorations`) | `InstancedPipes` routes select/context/bend/double-click via ray `instanceId`; selection is a per-instance colour; press-drag bends (Bend tool) |
| `InstancedFreeHubs.tsx` | End-to-end FREE (ball) hubs as 3 `InstancedMesh` (balls + eye bolts + cords), imperative useFrame transforms | ball click/context selects the joint; replaces JointLayer's old `FreeHub` |
| `InstancedWrapJoints.tsx` (**NEW**) | WRAPPED (swivel) pivots as 2 `InstancedMesh` (loop + arrowhead) | ONE canonical arrow baked in the joint local frame; each instance re-orients/scales it via `wrapFrameMatrix` (loop doesn't deform as the branch swivels). Rigid/anchor wraps stay declarative |
| `FittingLayer.tsx` (mod) | Auto-resolved fittings + conflicts, now INSTANCED (cyls + spheres + conflict markers pooled) | types resolved once (`useMemo`), geometry rebuilt from eased positions in a **v-gated** useFrame (idle = no cost) |
| `FormedLayer.tsx` (mod) | Heat-bent pipe tubes + Bend-tool control-point handles | dragging orange handles tweaks the bend |
| `MeasureLayer.tsx` | Persistent tape measures (dimension line + label) | selectable; offset perpendicular |
| `ElasticLayer.tsx` | Elastic bands (schema v8) — a thin orange tube between the two attachment points at eased positions | selectable (click → `selectElastic`); tints hotter with stretch; a `{memberId,t}` end lerps the member's eased endpoints |
| `MannequinLayer.tsx` | Static human mannequin (schema v9 `design.mannequin`) — the SAME `mannequinShapes()` the physics collides against, drawn as semi-transparent gray spheres/capsules/boxes | shown in edit AND Play; **not interactive** (no pointer handlers); static → reads the shapes once, no easing |
| `FormedLayer.tsx` | Heat-bent pipe as Catmull-Rom swept tubes | exports `formedCurve` (also used by IntersectionLayer) |
| `FittingLayer.tsx` | Auto-resolved socket fittings + conflict markers | `resolveFittings` + `buildFittingMesh`; cap 200 members |
| `JointLayer.tsx` (mod) | The FEW remaining declarative joints — rigid off-90° wraps (`WrapJoint` pin), anchor tees (`AnchorTee`), on-body free (`FreeJoint`) — + the swap gizmo | end-to-end free → `InstancedFreeHubs`, swivel wrapped → `InstancedWrapJoints` (both skipped here) |
| `WrapStrip.tsx` (mod) | Renderer for a `WrapMesh` (slip-saddle body + screws) | **name is legacy** — no longer a swept strip |
| `IntersectionLayer.tsx` | Red overlap shells | `intersectingMembers`; cap 200 |
| `DrawController.tsx` | Draw/formed preview + pointer target + marquee | window-listener drag; screen-space pipe/node snap (`pipePick`); Shift locks to a world axis line (incl. Y) |
| `SelectionHandles.tsx` | Endpoint drag handles + `MoveGizmo` + `RotateGizmo` | `useGroundDrag` window-listener hook wraps `beginGesture`/`endGesture`; endpoint handles are **single-select only** (a group/multi selection shows none — Move/Rotate the group as a unit or enter it) |
| `WireframeLayer.tsx` | Wireframe view (`W`) — pipes as 10px fat lines (drei `<Segments>`=Line2, one draw call) + junctions as 14px round `Points` dots | replaces the solid pipe/fitting/joint layers while `editorStore.wireframe` |
| `ExtendLayer.tsx` | Extend tool (`P`) push-cylinder gizmos on pipe ends (from `design/extend.extendDirections`); click → `startExtend` (axis-locked draw) | shown only in the `extend` tool; caps to selected-member ends on big models |
| `GuideLayer.tsx` | Placed guide lines (`Q`) — long dashed axis-coloured lines, always visible as snap aids | reads `editorStore.guides`; the in-progress draft preview lives in `DrawController` |

## Git state of this dir
NEW: `InstancedFreeHubs.tsx`, `InstancedWrapJoints.tsx`, `PhysicsDebug.tsx`, `instancing.ts`.
Modified: `Scene.tsx` (adds the instanced layers + `PhysicsDebug` + `__pvc.sceneStats`), `PipeLayer.tsx`
(pipes + bores + caps instanced), `FittingLayer.tsx` (instanced + v-gated), `JointLayer.tsx` (free
hubs + swivel wraps removed). **Nearly everything repeated is instanced** — a dense model is a handful
of draw calls (verify with `__pvc.sceneStats()`). Still per-mesh (few, or unique geometry): formed/bent
tubes (`FormedLayer`, unique curves), rigid-pin wraps + on-body free + anchor tees (`JointLayer`, rare).

## Depends on
`../../design/*`, `../../geometry/math3`, `../../schema`, `../../solver`, `../../solver/physics`,
`../../state/*` (appStore, editorStore, editorActions, animStore, cameraStore, themeStore), `../theme`,
`../units`, `three`, `@react-three/fiber`, `@react-three/drei`.

## Read before editing
- **Scene never subscribes to the doc; each layer subscribes itself** and re-renders off
  `useAnim((s)=>s.v)` during easing — so a drag (mutates doc every frame) doesn't re-render
  grid/gizmo/cameras. Preserve this.
- **Three CAD-swap seams**: `fittingMesh.ts`, `wrapMesh.ts`, `pipeModel.ts` — swap real CAD here
  without touching R3F code.
- **Instanced layers (`PipeLayer`/`InstancedFreeHubs`) do NOT subscribe to `useAnim`.** They build
  a *structural* spec (which instances exist + `instanceId→id` map) with `useMemo(…, [design])`, then
  refresh instance matrices imperatively in `useFrame` from `easedPos` — so per-frame motion (easing,
  pose, physics) costs no React re-render and the whole model is a handful of draw calls. Base
  geometry is UNIT-sized (see `instancing.ts`); size/length ride the instance matrix scale. Selection
  = per-instance colour (material `color` is white; `instanceColor` carries theme/select). Pointer
  events resolve the member/joint from `ev.instanceId`; set `frustumCulled={false}` (dynamic
  matrices). Verify draw-call collapse with `window.__pvc.sceneStats()` → `{meshes, instanced, instances}`.
- **Two independent window-listener drag systems** (DrawController inline + SelectionHandles
  `useGroundDrag`) exist for the same r3f reason (mesh drops pointerup when the ray leaves the mesh).
  If you change one, mirror the other. `useGroundDrag` passes a live **`DragMods`** (toggleable
  Shift/Ctrl — seeded at pointer-down, flipped by each mid-drag key press) to its `onMove`, not the
  raw event; the MoveHandle uses it for axis-lock (Shift) + detach/re-weld (Ctrl).
- **`MAX_*_MEMBERS=800` (JointLayer/FittingLayer/IntersectionLayer) / `MAX_ANIMATED_NODES=160`**
  are perf guards for huge designs; layers early-return above the cap. The 541-pipe quad T-rex
  fits the 800 member cap (renders all layers) but exceeds the 160-node animation cap on purpose
  (poses snap instantly, no per-frame easing).
- **`GeometryAnimator`** (in Scene) drives positions: physics step when simulating, else solver
  `pose` when `lengthsLocked`, else doc positions.

## Tests
`pipeModel.test.ts`, `fittingMesh.test.ts`, `wrapMesh.test.ts`, `ground.test.ts` (pure modules only).

_Update this file when you add/rename a layer or change the seams / subscription discipline._
