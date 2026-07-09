# src/state — zustand stores + the ONE action layer

The store split mirrors riglab: `appStore` = the persisted, undoable document; `editorStore` =
transient UI. `editorActions.ts` is the **single bridge** both the pointer tools and the
`window.__pvc` debug hook call. Two render stores (`animStore`, `cameraStore`) live outside React.

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `appStore.ts` (189) | Persisted/undoable document; the only write path | `useAppStore`, `createAppStore(store?)`, `updateCurrent(fn)`, `setViewport(patch)` (non-undoable doc-stored UI state), `undo`/`redo`, `beginGesture`/`endGesture`, project lifecycle (`createProject`, `openProject`, `importAndOpen`, …) |
| `editorStore.ts` (161) | Transient viewport/editing state (never persisted/undone) | `useEditorStore`, `Tool` (`select`\|`draw`\|`formed`\|`move`\|`rotate`\|`measure`\|`bend`\|`elastic`), `Projection`, `selectedJointId`/`selectedMeasurementId`/`selectedElasticId`, `sizeMenu`, `measureFrom`/`measureAdjustId`, `elasticFrom`, `drawLength`/`drawDirection`, `bendLockEndAngles`/`bendLengthLock`, tool/selection/marquee/joinMenu/snap actions |
| `editorActions.ts` (397) | **The one action layer** — composes pure snapping + docOps, commits via `updateCurrent` | `placeDrawPoint`, `snapDrawPoint`, `finishPath`, `dragNodeTo`, `dragMemberEndLength`, `setMemberLength`, `translateMemberBy`, `rotateMemberBy`, `setJoinMode`, `swapJointReceiver`, `setPivotAngle`, `dragLocked`, `pivotAnglesOf`, `jointOrientationsOf`, `placeElasticPoint`/`setElasticTension`/`deleteElastic`, `setMannequin`/`setJointDamping` (schema v9 doc flags) |
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
- **editorStore = transient UI.** Only the `snap` field is persisted (localStorage workspace pref,
  excluded from `resetTransient`). `setTool` clears in-progress draw/formed state on tool change.

## Doc-stored viewport state (schema v6)
Opening a document restores its own camera pose + tool + projection + drawSize
(`design.viewport`) and resets transient state — it does NOT inherit the previous
document's view. `EditorShell` runs the restore effect (keyed on the doc id) and a
persist effect (tool/projection/drawSize → `setViewport`); `Scene.CameraPoseSync`
debounces the resting camera pose to `setViewport` (600 ms) so orbiting doesn't
churn the doc; `Scene.ViewController` applies `cameraStore.requestPose`/`setView`
to the live camera. `setViewport` is **non-undoable** (temporal paused).

## `window.__pvc` — the scripted automation contract
The hook is **defined in `../ui/EditorShell.tsx`** and merged (not replaced) onto `window`;
`../ui/scene/Scene.tsx` adds camera seams. It calls THESE actions, giving pointer/script parity.
Read seams: `getDoc`, `getEditor`, `getFittings` (`{fittings, conflicts}`), `getMembers`,
`getJoints`, `getSolve`, `getBom`, `getPhysics`, `exportJson`. Command seams: `setTool`,
`setDrawSize`, `setProjection`, `setLengthsLocked`, `draw`/`finishPath`, `drawFormed`, `dragNode`,
`moveMember`, `rotateMember`, `setJoinMode`, `makeManufacturedJoint`, `makeFreeHub`,
`bendMember` (optional length-ref arg), `setBendLengthLock`, `setPivotAngle`, `importJson`,
`setSimulating`, `placeElastic`/`getElastics`/`setElasticTension`/`selectElastic`/`deleteElastic`,
`setMannequin`/`setJointDamping` (schema v9), `setSelection`/`openJoinMenu` (scripted-screenshot/test helpers).
(Examples load via `appStore.createFromExample`, not a `__pvc` seam.)

## Read before editing
- **`updateCurrent` is the only doc write path** — never mutate `current` directly, or you break
  undo + autosave.
- **`setPivotAngle` is coupled**: in a locked mechanism with ≥2 joints it re-`solve`s and writes
  back every OTHER wrapped joint's resolved angle so closed loops stay closed.
- **`segmentsOf` gives only straight members a `memberId`** — an on-pipe hit on a straight can
  split into a tee; formed members snap to the chord but never split.
- **`animStore`'s eased map is module-global** (not in the store) — tests use unique node ids.
- **snap persists across tests** — `editorActions.test.ts`/`editorStore` re-set it in `beforeEach`.

_Update this file when you add a `__pvc` seam, a store field, or change the write path._
