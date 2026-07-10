# src/state — zustand stores + the ONE action layer

The store split mirrors riglab: `appStore` = the persisted, undoable document; `editorStore` =
transient UI. `editorActions.ts` is the **single bridge** both the pointer tools and the
`window.__pvc` debug hook call. Two render stores (`animStore`, `cameraStore`) live outside React.

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `appStore.ts` (384) | Persisted/undoable document; the only write path | `useAppStore`, `createAppStore(store?)`, `updateCurrent(fn)`, `setViewport(patch)` (non-undoable doc-stored UI state), `undo`/`redo` (past the temporal floor, undo keeps stepping backward through PERSISTED Dexie revisions — see The split), `beginGesture`/`endGesture` (+ reactive `gestureActive` flag — chrome suppresses hover popups mid-drag), project lifecycle (`createProject`, `openProject`, `importAndOpen`, …) |
| `editorStore.ts` | Transient viewport/editing state (never persisted/undone) | Existing tool/selection/draw/sim fields plus mobile-only `navigationMode`, `mobileMultiSelect`, and `mobileSheet`; none is persisted or undone |
| `editorActions.ts` (397) | **The one action layer** — composes pure snapping + docOps, commits via `updateCurrent` | `placeDrawPoint`, `snapDrawPoint` (honours `drawAxisLock` + injects guide∩pipe `guidePoints`), `finishPath`, `dragNodeTo`, `translateMembersBy`/`rotateMembersBy` (rigid-body group transforms), `setMemberLength`, `setJoinMode`, `setPivotAngle`, `dragLocked`, group ops (`groupSelection`/`ungroupSelection`/`enterGroup`/`exitGroup`/`selectTreeMember`/`selectTreeGroup`/`setGroupColor`), `startExtend` (extend tool → axis-locked draw), guide ops (`pickGuideRef`/`placeGuide`/`placeGuideAtOffset`/`clearGuides`/`cancelGuideDraft`), `placeElasticPoint`/`setElasticTension`, `setMannequin`/`setJointDamping`, `solveIntersections` (one undo entry; returns joined count) |
| `animStore.ts` (64) | Eased render positions so grid snaps glide (module-global map, outside React) | `useAnim`, `easedPos(id)`, `stepEasing`, `bumpAnim` |
| `cameraStore.ts` (99) | Camera pose across ortho⇄perspective toggle + view presets + imperative pose requests (module singleton) | `getCameraPose`, `recordPose`, `orthoInit`, `perspInit`, `PERSP_FOV`, `requestPose`/`getPoseVersion`/`resetPose`, `setView`/`VIEW_PRESETS`/`ViewName` |
| `themeStore.ts` (23) | Day/night preference (localStorage) | `useThemeStore` (`night`, `setNight`, `toggleNight`) |

## Depends on
`../design/*` (docOps, snapping, dragMath, formed), `../geometry/math3`, `../schema`, `../solver`,
`../examples`, `../persistence/*`.

## The split
- **appStore = the document.** Wrapped in zundo `temporal` (partialize to `{current}`, limit 100).
  `updateCurrent(fn)` is the ONLY write path (computes next, sets `current`, schedules autosave).
  **Gesture batching**: `beginGesture`/`endGesture` produce exactly ONE undo entry per drag.
  `temporal.clear()` on create/open/close so history never leaks across projects.
- **Undo past the temporal floor** (closure state in `createAppStore`): once `pastStates` is empty,
  `undo()` steps back one persisted revision per press — but only revisions with
  `revId <= sessionBaseRevId` (captured at open; the session's own autosaves are temporal's job).
  Steps set `current` with temporal PAUSED (never a past entry, never clears the future), skip
  snapshots `sameDesign`-identical to the screen (viewport ignored; the user's camera is kept),
  and persist debounced via `ProjectStore.putProject` — NO new revision minted. `redo()` pops the
  visited-revision forward stack BEFORE temporal redo (both can coexist: the temporal future may
  still hold undone session edits). `updateCurrent` = a branch: clears cursor + forward stack.
  Loads are async behind a `revBusy` flag — presses mid-load are dropped, never interleaved.
- **editorStore = transient UI.** `snap` and `rendererEffects` (default off) are persisted localStorage
  workspace prefs (not document state). `resetTransient()` preserves `rendererEffects` AND
  `toolPaletteLayout` (session-only, not persisted). `sceneStatus` and `hoveredSceneItem`
  are session-only scene semantic state. `setTool` clears in-progress draw/formed state on tool change.

## Doc-stored viewport state (schema v6)
Opening a document restores its own camera pose + tool + projection + drawSize
(`design.viewport`) and resets transient state — it does NOT inherit the previous
document's view. `EditorShell` runs the restore effect (keyed on the doc id) and a
persist effect (tool/projection/drawSize → `setViewport`); `Scene.CameraPoseSync`
debounces the resting camera pose to `setViewport` (600 ms) so orbiting doesn't
churn the doc; `Scene.ViewController` applies `cameraStore.requestPose`/`setView`
to the live camera. `setViewport` is **non-undoable** (temporal paused).

## `window.__pvc` — the scripted automation contract
The hook is **registered in `../ui/editor/PvcAutomationBridge.tsx`** and merged (not replaced) onto
`window`; `../ui/scene/Scene.tsx` adds camera + pointer-debug seams. It calls THESE actions, giving pointer/script parity.
Read seams: `getDoc`, `getEditor`, `getFittings` (`{fittings, conflicts}`), `getMembers`,
`getJoints`, `getSolve`, `getBom`, `getPhysics`, `getPhysicsFormed` (live sim bend control points,
memberId → Vec3[]), `exportJson`. Command seams: `setTool`,
`setDrawSize`, `setProjection`, `setLengthsLocked`, `draw`/`finishPath`, `drawFormed`, `dragNode`,
`moveMember`, `rotateMember`, `setJoinMode`, `makeManufacturedJoint`, `makeFreeHub`,
`bendMember` (optional length-ref arg), `setBendLengthLock`, `setPivotAngle`, `importJson`,
`solveIntersections` (joins every red crossing — straight AND formed pipes — with rigid
fabricated unions AND fixes recordless junction conflicts: nonstandard 2-end corners become
heat-bent formed members, 3+-end no-fitting junctions get anchor records; returns the fix count;
`getIntersections` reads the flagged member ids; `getEditor` also reports `hoveredSceneItem`
for hover probes),
`setSimulating`, `placeElastic`/`getElastics`/`setElasticTension`/`selectElastic`/`deleteElastic`,
`setMannequin`/`setJointDamping` (v9-introduced fields in current schema v10), `setWireframe`, `setRendererEffects`, `setToolPaletteLayout` (`getEditor` reports `rendererEffects` + `toolPaletteLayout`), `setSelection`/`openJoinMenu`, mobile seams (`setNavigationMode`, `setMobileMultiSelect`, `getResponsiveLayout`; `getEditor` reports the mobile transient fields),
group seams (`groupSelection`/`ungroupSelection`/`enterGroup`/`exitGroup`/`getEnteredGroup`) (scripted-screenshot/test helpers).
Scene diagnostics: `sceneStats`, `getCameraPos`, `getCameraTarget`, `screenOf`, `marquee`,
`getPointerDebug`, `clearPointerDebug`.
(Examples load via `appStore.createFromExample`, not a `__pvc` seam.)

## Read before editing
- **`updateCurrent` is the only doc write path** — never mutate `current` directly, or you break
  undo + autosave.
- **`setPivotAngle` is coupled**: in a locked mechanism with ≥2 joints it re-`solve`s and writes
  back every OTHER wrapped joint's resolved angle so closed loops stay closed.
- **`segmentsOf` gives only straight members a `memberId`** — an on-pipe hit on a straight can
  split into a tee; formed members snap to the chord but never split. `cornersOf` feeds formed
  members' bend control points into the draw/formed/measure/drag snap contexts as end-priority
  `'corner'` point targets (geometric snap only — no node forms).
- **`endGesture` records an entry only when the doc REFERENCE changed** since `beginGesture` —
  cancel paths (e.g. the rotate tool's typed-angle Escape in `ui/scene/SelectionHandles.tsx`)
  restore the captured pre-gesture doc verbatim via `updateCurrent(() => preDoc)` so the gesture
  closes with NO history entry. Rotating back by the inverse angle would NOT achieve this (new
  reference + FP drift).
- **`animStore`'s eased map is module-global** (not in the store) — tests use unique node ids.
- **snap persists across tests** — `editorActions.test.ts`/`editorStore` re-set it in `beforeEach`.

_Update this file when you add a `__pvc` seam, a store field, or change the write path._
