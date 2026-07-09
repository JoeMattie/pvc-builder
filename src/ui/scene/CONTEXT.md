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
| `axis.ts` | Place a unit-Y primitive along a segment (from riglab) | `placeAxis(a,b)`, `orientY(dir)`, `orientZ(dir)` |

## Impure R3F components

| File | Responsibility | Notes |
|---|---|---|
| `Viewport.tsx` | The `<Canvas>` host | soft shadows, wraps `<Scene>` |
| `Scene.tsx` (mod) | Composes everything: cameras, lights, layers, gizmos, headless drivers | **does NOT subscribe to the doc** — each layer subscribes itself |
| `PipeLayer.tsx` (mod) | Straight pipe cylinders + hollow bores (PBR) + Bend-tool drag + ghost end-cap extensions | click-select; right-click routes join/size menu; press-drag bends (Bend tool); translucent BOM end-cap ghosts |
| `FormedLayer.tsx` (mod) | Heat-bent pipe tubes + Bend-tool control-point handles | dragging orange handles tweaks the bend |
| `MeasureLayer.tsx` | Persistent tape measures (dimension line + label) | selectable; offset perpendicular |
| `FormedLayer.tsx` | Heat-bent pipe as Catmull-Rom swept tubes | exports `formedCurve` (also used by IntersectionLayer) |
| `FittingLayer.tsx` | Auto-resolved socket fittings + conflict markers | `resolveFittings` + `buildFittingMesh`; cap 200 members |
| `JointLayer.tsx` (**NEW**) | Unified joints from `design.joints[]` — wrapped/anchor/free | dispatches `WrapJoint`/`FreeJoint`/`FreeHub`; end-to-end free joints at one node draw as ONE shared ball (`FreeHub`), backed by the pairwise records |
| `WrapStrip.tsx` (mod) | Renderer for a `WrapMesh` (slip-saddle body + screws) | **name is legacy** — no longer a swept strip |
| `IntersectionLayer.tsx` | Red overlap shells | `intersectingMembers`; cap 200 |
| `DrawController.tsx` | Draw/formed preview + ground pointer target + marquee | window-listener drag; view-facing plane for wall drawing |
| `SelectionHandles.tsx` | Endpoint drag handles + `MoveGizmo` + `RotateGizmo` | `useGroundDrag` window-listener hook wraps `beginGesture`/`endGesture` |

## Git state of this dir
NEW/untracked: `JointLayer.tsx`. DELETED: `PivotLayer.tsx`, `WrapLayer.tsx` (both folded into
`JointLayer`). Modified: `Scene.tsx`, `PipeLayer.tsx`, `WrapStrip.tsx`, `pipeModel.ts`.

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
- **Two independent window-listener drag systems** (DrawController inline + SelectionHandles
  `useGroundDrag`) exist for the same r3f reason (mesh drops pointerup when the ray leaves the mesh).
  If you change one, mirror the other.
- **`MAX_*_MEMBERS=800` (JointLayer/FittingLayer/IntersectionLayer) / `MAX_ANIMATED_NODES=160`**
  are perf guards for huge designs; layers early-return above the cap. The 541-pipe quad T-rex
  fits the 800 member cap (renders all layers) but exceeds the 160-node animation cap on purpose
  (poses snap instantly, no per-frame easing).
- **`GeometryAnimator`** (in Scene) drives positions: physics step when simulating, else solver
  `pose` when `lengthsLocked`, else doc positions.

## Tests
`pipeModel.test.ts`, `fittingMesh.test.ts`, `wrapMesh.test.ts`, `ground.test.ts` (pure modules only).

_Update this file when you add/rename a layer or change the seams / subscription discipline._
