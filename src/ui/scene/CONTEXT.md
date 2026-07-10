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
| `jointStyle.ts` | How a rigid (anchor) union draws: socket TEE (lone ~90° on-body branch — exactly 3 pipe ends), wrap-arrow pin (other angles), or ONE brown fabricated-union SPHERE per node when the cluster exceeds any standard fitting — >3 pipe ends, OR an end-to-end record at a 3-end junction (three ends, no straight run). `anchorRendersAsHub` gates EVERY anchor render + its hit target | `anchorRendersAsTee`, `anchorRendersAsHub`, `junctionEndCount` |
| `ground.ts` | Raycasting helpers | `rayToGround`, `rayToPlane`, `dominantAxisNormal` |
| `pipePick.ts` | Screen-space snap: nearest node / formed-bend CORNER / pipe under the cursor (draw + endpoint drag, any height) | `pickSnapPoint` (kinds `node`\|`corner`\|`pipe`; corners gate with the ends toggle), `SNAP_PX`, `snapDebug` |
| `rightClickGesture.ts` | Shared right-button gesture gate + debug event ring | lets orbit win over pipe/joint menus AND the draw/formed right-click path-end (`wasRightDrag`, consumed by `ui/editor/useEditorHotkeys.ts`) after drag slop; `getPointerDebugEvents()` |
| `touchGestures.ts` | Shared active-touch tracker and edit guard | second touch clears previews/menus; Edit vs Orbit arbitration stays transient |
| `axis.ts` | Place a unit-Y primitive along a segment (from riglab) | `placeAxis(a,b)`, `orientY(dir)`, `orientZ(dir)` |
| `instancing.ts` | Compose per-instance matrices for `InstancedMesh` from UNIT base geometry (radius/height 1); per-instance GHOST alpha for entered-group dimming | `cylinderMatrix(out,a,b,r)`, `sphereMatrix`, `ringMatrix`, `coneMatrix`, `wrapFrameMatrix` (joint-local basis), `hideMatrix`, `GROUP_DIM_ALPHA`, `instanceAlphaPatch`, `setInstanceAlphas` |

## Impure R3F components

| File | Responsibility | Notes |
|---|---|---|
| `Viewport.tsx` | The `<Canvas>` host | soft shadows, wraps `<Scene>` |
| `Scene.tsx` (mod) | Composes everything: cameras, lights, postprocessing, layers, gizmos, headless drivers | **does NOT subscribe to the doc** — each layer subscribes itself; custom right-drag orbits around cursor-picked anchors; exports `preloadRendererEffects()` |
| `RendererEffectsPass.tsx` | The postprocessing chain (N8AO + Blender-style cavity + SMAA) as a **lazy chunk** | loaded on demand by `Scene.RendererEffects`; warmed from `ProjectList` on idle via `preloadRendererEffects()`; patches the composer's NormalPass to render OPAQUE meshes only |
| `cavityEffect.ts` | Blender Workbench screen-space cavity (`CavityEffect extends postprocessing.Effect`): view-space normal-buffer curvature, ridges brighten / valleys darken | no React; Blender-scale `ridge`/`valley` (0..2) + `offset` (texels) setters; consumed by `RendererEffectsPass` |
| `PipeLayer.tsx` (mod) | Straight pipe bodies as ONE `InstancedMesh` + INSTANCED bores + end-cap ghosts (`PipeDecorations`) | `InstancedPipes` routes select/menu/bend/double-click via ray `instanceId`; selection commits on pointer-UP within click slop against the PRESS-time hit (r3f's synthetic click dies when the camera drifts — damping/grazing views), Ctrl/Cmd toggles the member/group in the selection, and pipe presses stopPropagation so the ground plane's empty-click clear never races a pipe click (FormedLayer mirrors all of this); right-button menus use pointer-up after the shared orbit gate; selection is a per-instance colour |
| `InstancedFreeHubs.tsx` | End-to-end FREE (ball) hubs as 3 `InstancedMesh` (balls + eye bolts + cords), imperative useFrame transforms | ball click selects the joint; right-button-up after the shared orbit gate opens its menu; replaces JointLayer's old `FreeHub` |
| `InstancedWrapJoints.tsx` (**NEW**) | WRAPPED (swivel) pivots as 2 `InstancedMesh` (loop + arrowhead) | ONE canonical arrow baked in the joint local frame; each instance re-orients/scales it via `wrapFrameMatrix` (loop doesn't deform as the branch swivels). Rigid/anchor wraps stay declarative |
| `FittingLayer.tsx` (mod) | Auto-resolved fittings + conflicts, now INSTANCED (cyls + spheres + conflict markers pooled) | types resolved once (`useMemo`), geometry rebuilt from eased positions in a **v-gated** useFrame (idle = no cost) |
| `FormedLayer.tsx` (mod) | Heat-bent pipe tubes + Bend-tool control-point handles | dragging orange handles tweaks the bend; mid-sim the curve uses `physicsFormedControlPoints()` (bends ride the rigid body) and handles hide; `formedCurve(member, at, controlPoints?)` takes the override |
| `MeasureLayer.tsx` | Persistent tape measures (dimension line + label) | selectable; offset perpendicular |
| `ElasticLayer.tsx` | Elastic bands (schema v8) — a thin orange tube between the two attachment points at eased positions | selectable (click → `selectElastic`); tints hotter with stretch; a `{memberId,t}` end lerps the member's eased endpoints |
| `MannequinLayer.tsx` | Static human mannequin (schema v9 `design.mannequin`) — the SAME `mannequinShapes()` the physics collides against, drawn as semi-transparent gray spheres/capsules/boxes | shown in edit AND Play; **not interactive** (no pointer handlers); static → reads the shapes once, no easing |
| `FormedLayer.tsx` | Heat-bent pipe as Catmull-Rom swept tubes | exports `formedCurve` (also used by IntersectionLayer) |
| `FittingLayer.tsx` | Auto-resolved socket fittings + conflict markers | `resolveFittings` + `buildFittingMesh`; cap 200 members |
| `JointLayer.tsx` (mod) | The FEW remaining declarative joints — rigid off-90° wraps (`WrapJoint` pin), anchor tees (`AnchorTee`), on-body free (`FreeJoint`), and `FabricatedHub` (ONE brown sphere per node for a many-way anchor cluster, gated by `anchorRendersAsHub`; clickable / right-clickable / group-ghosted like the other hardware) — + the swap gizmo | end-to-end free → `InstancedFreeHubs`, swivel wrapped → `InstancedWrapJoints` (both skipped here); `pipeModel` skips pull-back at tee AND hub nodes so pipes run full into the hardware |
| `WrapStrip.tsx` (mod) | Renderer for a `WrapMesh` (slip-saddle body + screws) | **name is legacy** — no longer a swept strip |
| `IntersectionLayer.tsx` | Red overlap shells | `intersectingMembers`; cap 200 |
| `interactions.ts` | Shared scene pointer-drag lifecycle + ground/view-plane drag hook | used by DrawController, Bend tool, endpoint/transform handles |
| `DrawController.tsx` | Draw/formed preview + pointer target + marquee | window-listener drag; screen-space pipe/node snap (`pipePick`); Shift locks to a world axis line (incl. Y) |
| `SelectionHandles.tsx` | Endpoint drag handles + `MoveGizmo` + `RotateGizmo` | `useGroundDrag` window-listener hook wraps `beginGesture`/`endGesture`; endpoint handles are **single-select only** (a group/multi selection shows none — Move/Rotate the group as a unit or enter it). A rotate-ring CLICK (≤ `CLICK_SLOP_PX`, no drag) opens a typed-angle input (degrees, drei `Html`, `data-viewport-occluder`, `data-numeric-entry`) anchored to that ring: typing live-previews via the SAME `rotateMembersBy` action/pivot/axis a ring drag uses inside one open gesture — Enter commits (ONE undo entry); Escape / blur / clicking elsewhere / leaving the tool restores the pre-typed doc verbatim (no history entry). Its keydown obeys the shared numeric-entry allow-list (`ui/editor/numericEntryKeys.ts`): kept keys are stopPropagation'd; a disallowed letter or Space preventDefaults, reverts-and-closes, and is NOT stopped so the global hotkey fires |
| `WireframeLayer.tsx` | Wireframe view (`W`) — pipes as 5px fat lines (drei `<Segments>`=Line2, one draw call) + junctions as 14px round `Points` dots | replaces the solid pipe/fitting/joint layers while `editorStore.wireframe` |
| `ExtendLayer.tsx` | Extend tool (`P`) push-cylinder gizmos on pipe ends (from `design/extend.extendDirections`); pointer-down on a stub → `startExtend` (axis-locked draw) | gated on `tool === 'extend'` ONLY (no `drawingFromNodeId` guard) so stubs stay mounted during an active push; a click-drag places the axis-locked point on release (window drag — live preview comes from DrawController's ground-plane pointermove); caps to selected-member ends on big models |
| `GuideLayer.tsx` | Placed guide lines (`Q`) — long dashed axis-coloured lines, always visible as snap aids | reads `editorStore.guides`; the in-progress draft preview lives in `DrawController` |
| `SceneLabels.tsx` | Viewport semantic labels | BOM `P#` cut IDs when `editorStore.sceneStatus === 'fabricate'`; selected/hover labels for pipes, joints, fittings/conflicts (multi-select shows ONE centroid summary pill; hover labels are suppressed while `appStore.gestureActive`); positions are updated imperatively from eased node positions; fabricate labels project through the camera and HIDE when inside UI rects (`[data-floating-island]`, `[data-viewport-occluder]`, menus/popovers); drei `Html zIndexRange={[18, 0]}` keeps them under chrome. ⚠ pills MUST stay pointer-transparent: `pointerEvents:'none'` goes on the drei `Html` WRAPPER (not just the pill div), or the mid-pipe hover label blocks the canvas → pointerout → popup unmount/remount flicker |

## Git state of this dir
NEW: `InstancedFreeHubs.tsx`, `InstancedWrapJoints.tsx`, `PhysicsDebug.tsx`, `instancing.ts`.
Modified: `Scene.tsx` (adds the instanced layers + `PhysicsDebug` + `__pvc.sceneStats`/pointer debug), `PipeLayer.tsx`
(pipes + bores + caps instanced), `FittingLayer.tsx` (instanced + v-gated), `JointLayer.tsx` (free
hubs + swivel wraps removed). **Nearly everything repeated is instanced** — a dense model is a handful
of draw calls (verify with `__pvc.sceneStats()`). Still per-mesh (few, or unique geometry): formed/bent
tubes (`FormedLayer`, unique curves), rigid-pin wraps + on-body free + anchor tees (`JointLayer`, rare).

## Depends on
`../../design/*`, `../../geometry/math3`, `../../schema`, `../../solver`, `../../solver/physics`,
`../../state/*` (appStore, editorStore, editorActions, animStore, cameraStore, themeStore), `../theme`,
`../units`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`.

## Read before editing
- **Scene never subscribes to the doc; each layer subscribes itself** and re-renders off
  `useAnim((s)=>s.v)` during easing — so a drag (mutates doc every frame) doesn't re-render
  grid/gizmo/cameras. Preserve this.
- **Right-drag orbit is custom** (`CursorAnchorOrbit` in `Scene.tsx`): stock right-button
  `OrbitControls` rotation stays disabled; middle-pan and wheel zoom remain OrbitControls. The anchor
  comes from `pipePick` screen-space snap, falling back to `rayToGround`.
- **Scene right-click menus must go through `rightClickGesture.ts`.** Menus open on right-button up
  only when the right gesture did not become an orbit; do not add raw r3f `onContextMenu` menu opens
  for pipes/joints/hubs. `window.__pvc.getPointerDebug()` exposes recent orbit/menu/hover decisions.
- **Renderer effects are transient workspace state** (`editorStore.rendererEffects`, default off):
  when enabled, `Scene.RendererEffects` suspends in the lazy `RendererEffectsPass.tsx` chunk
  (full-resolution N8AO + Blender-style cavity (`cavityEffect.ts`) + SMAA). `preloadRendererEffects()`
  (exported from `Scene.tsx`) warms the chunk — `ProjectList` calls it on idle; `EditorShell` shows a
  brief blur overlay while the toggle (re)builds the chain. ⚠ The cavity reads the composer's
  NormalPass, whose override material ignores transparency — `RendererEffectsPass` hides
  transparent-material meshes during that pass (else the invisible 200 m pointer/shadow plane, grid,
  and drag ghosts render as phantom planes outlined by the cavity). Keep helper/overlay meshes
  `transparent: true` so they stay excluded.
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
- **Entered-group ghosting is SEMI-TRANSPARENCY, not gray-lerp** (`GROUP_DIM_ALPHA` = 0.18,
  colour/tint kept). Instanced layers dim per instance via `instancing.ts`: a 1-float
  `aInstanceAlpha` `InstancedBufferAttribute` + `instanceAlphaPatch` as the material's
  `onBeforeCompile` (injects `diffuseColor.a *= vInstanceAlpha` after `color_fragment`), with
  `setInstanceAlphas(mesh, alphaOf)` rewriting the attribute in a `useEffect` on enter/exit —
  NEVER per frame. Declarative meshes (JointLayer hardware, FormedTube) flip
  `transparent`/`opacity` props instead. ⚠ three bakes an `OPAQUE` define into programs compiled
  while `transparent === false` that FORCES fragment alpha to 1 — any `transparent` flip must
  recompile: `setInstanceAlphas` bumps `material.needsUpdate` on the flip; declarative materials
  carry `key={dimmed ? 'dim' : 'solid'}` to remount. A dimmed pipe/joint/fitting is also INERT
  (no select/hover/menu). Dim membership: a member is dimmed when outside the entered group's
  `memberIds`; a joint/fitting/hub when ALL its incident members are outside.
- **Window-listener drags share `interactions.ts`** for the same r3f reason (mesh drops pointerup
  when the ray leaves the mesh). `useGroundDrag` passes a live **`DragMods`** (toggleable Shift/Ctrl
  — seeded at pointer-down, flipped by each mid-drag key press) to its `onMove`, not the raw event;
  the MoveHandle uses it for axis-lock (Shift) + detach/re-weld (Ctrl). Draw/marquee and Bend-tool
  drags use `startWindowPointerDrag` directly.
- **`MAX_*_MEMBERS=800` (JointLayer/FittingLayer/IntersectionLayer) / `MAX_ANIMATED_NODES=160`**
  are perf guards for huge designs; layers early-return above the cap. The 541-pipe quad T-rex
  fits the 800 member cap (renders all layers) but exceeds the 160-node animation cap on purpose
  (poses snap instantly, no per-frame easing).
- **`GeometryAnimator`** (in Scene) drives positions: physics step when simulating, else solver
  `pose` when `lengthsLocked`, else doc positions. Node positions flow through `easedPos`; formed
  BEND control points are not nodes — mid-sim `FormedLayer`/`IntersectionLayer`/`SceneLabels`
  substitute `physicsFormedControlPoints()` for `member.controlPoints` (doc coords are frozen at
  the sim's rest pose). Marquee/draw hit-tests (`DrawController.memberScreenPts`, `__pvc.marquee`)
  deliberately keep doc control points (editing mid-sim doesn't matter).
- **No CONTROLLED `<input>`s inside drei `Html`.** Html renders its children into a separate React
  DOM root; a `value=` bound to state in the r3f tree can't flush synchronously across the two
  roots, so React DOM restores the stale value between keystrokes (typing "30" degrades to "0").
  Keep such inputs uncontrolled (`defaultValue` + parse `e.target.value`) — see
  `RotateAngleInput` in `SelectionHandles.tsx`.

## Tests
`pipeModel.test.ts`, `fittingMesh.test.ts`, `wrapMesh.test.ts`, `ground.test.ts`,
`jointStyle.test.ts` (pure modules only).

_Update this file when you add/rename a layer or change the seams / subscription discipline._
