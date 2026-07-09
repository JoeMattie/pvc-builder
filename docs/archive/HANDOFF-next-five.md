# Handoff — next five interaction items

You (a fresh Claude Code session) are picking up **pvc-builder** to implement five
user-requested items. Read `CLAUDE.md` and `DECISIONS.md` first — this doc adds the
specific plan. All phases (0–5) plus CrashCat physics are already done and green.

## The five tasks (from the user, verbatim intent)

1. **Move tool** — hotkey `m`, with translate **move-arrows** on the selected pipe,
   "much like the length arrows."
2. **Length-arrow jump** — when dragging a length arrow, the *first* move after
   grabbing sometimes jumps to a big length change. Fix the grab so it tracks the
   cursor delta.
3. **Marquee (rubber-band) select** in the select tool — drag a rectangle on empty
   space. **See "Open question" below about direction semantics.**
4. **ISO ↔ Perspective must not reset the camera** position/target on toggle.
5. **Tee from two pipes** — drawing a branch onto the *middle* of an existing pipe
   should split that pipe and form a tee (currently the branch just floats to a point
   and no fitting forms). The user also said "and can't pivot currently" — see the
   Open question.

Work through them in this order (2 and 4 are quick correctness fixes; do them first).
Commit each item (or a small pair) separately with the gate green, and push.

---

## Environment & commands

**Node is via nvm, not on PATH.** Prefix every shell command:
```
export NVM_DIR="$HOME/.config/nvm"; . "$NVM_DIR/nvm.sh"   # Node 26 / npm 11
```
Gate (definition of done): `npm run typecheck`, `npm run lint`, `npm run test`,
`npm run build` all green. `npm run e2e` runs the Playwright smoke on the built app.

**Browser verification pattern** (used throughout this project — copy it): start the
preview server, drive the app through `window.__pvc`, assert + screenshot, kill server.
```
npm run build >/dev/null 2>&1
npm run preview -- --port 4321 --strictPort >/tmp/preview.log 2>&1 &
PREV=$!; sleep 3
node ./verify-temp.mjs        # a throwaway script using @playwright/test's chromium
kill $PREV 2>/dev/null; rm -f ./verify-temp.mjs
```
The verify script must live **inside the repo root** (so it resolves `@playwright/test`),
create/open a project, `await page.waitForFunction(() => window.__pvc?.getDoc?.() !== null)`,
then `page.evaluate` against `window.__pvc`. Read screenshots back with the Read tool to
judge visuals. Chromium is already cached (no network install needed).

---

## Architecture you must respect

The whole app is built around **pure cores behind narrow interfaces**, bridged to the UI
by ONE action layer. Put logic in the pure/tested layer; expose it through
`editorActions` + a `window.__pvc` seam; never inline geometry in a component.

- **`src/design/docOps.ts`** — pure `Design → Design` transforms (tested in
  `docOps.test.ts`). e.g. `addMember`, `setNodePosition`, `deleteMember`, `addPivot`.
- **`src/design/snapping.ts`** — pure `snapPoint(raw, ctx): SnapResult` (node → on-pipe →
  axis inference → grid → free). `SnapResult = { position, kind, nodeId?, guide? }`.
- **`src/design/dragMath.ts`** — `projectLengthOnAxis`, `lockToNearestAxis` (pure, tested).
- **`src/state/editorActions.ts`** — the bridge. Every tool AND the `__pvc` hook call
  these. e.g. `placeDrawPoint`, `snapDrawPoint`, `dragNodeTo`, `dragMemberEndLength`,
  `dragLocked`, `createPivotAt`, `resetPivots`.
- **`src/state/editorStore.ts`** — transient UI state. `Tool = 'select'|'draw'|'formed'|
  'pivot'`; `selectedIds: string[]` (already an array → multi-select ready);
  `simulating: boolean`; `snap` settings.
- **`src/ui/scene/*`** — the r3f scene. `Scene.tsx` (cameras/lights/grid/controls +
  `GeometryAnimator`), `DrawController.tsx` (ground-plane pointer target + draw/formed
  preview + select-empty deselect), `SelectionHandles.tsx` (endpoint move spheres +
  length arrows — the pattern for the move tool), `PipeLayer`/`FormedLayer`/`FittingLayer`/
  `IntersectionLayer`/`PivotLayer`.
- **Eased render positions** (`src/state/animStore.ts`): the viewport renders **eased**
  node positions, not raw doc positions. `GeometryAnimator` (in `Scene.tsx`) picks the
  per-frame target: physics body positions when `simulating`, else the kinematic
  `solve()` when `lengthsLocked && pivots`, else the document. Scene layers read
  `easedPos(nodeId)`. **Anything that renders geometry at a node should read `easedPos`
  with a fallback to the doc position** — see how `SelectionHandles`/`FittingLayer` do it.
- **Drag rig** (`SelectionHandles.tsx` → `useGroundDrag`): the canonical way to do a
  pointer drag in the scene. It suspends OrbitControls, listens on `window` for
  move/up (so the drag survives the cursor leaving the tiny handle), raycasts the
  ground plane (`rayToGround`), and always re-enables controls on pointerup. **Reuse
  `useGroundDrag` for the move tool** — do NOT hand-roll mesh pointer capture (that
  caused the stuck-camera bug we already fixed).
- **`window.__pvc` seams** live in `src/ui/EditorShell.tsx` (search `hook.`). Add a seam
  for anything you want to verify headlessly.
- **Pillbox** (`src/ui/Pillbox.tsx`) = the tool buttons; **EditorShell** keyboard handler
  (search `onKey`) = hotkeys. Left mouse button is already reserved (OrbitControls
  `mouseButtons` in `Scene.tsx` has no LEFT → middle pans, right rotates) — free for
  the marquee.

---

## Task 4 — ISO/Perspective must not reset the camera (do this first; quick)

**Where:** `src/ui/scene/Scene.tsx`. Two cameras (`OrthographicCamera` /
`PerspectiveCamera`) with a fixed `ISO_DIR = [3.2,3.2,3.2]`, `ORTHO_ZOOM = 230`, and
`<OrbitControls key={projection} ...>`. The `key` remounts OrbitControls on toggle and
the new camera mounts at `ISO_DIR` → the view snaps back.

**Approach:** keep a shared camera pose across the toggle.
- Add a tiny module store (mirror `animStore.ts`) holding `{ position:[x,y,z],
  target:[x,y,z], zoom }`, updated from OrbitControls' `onChange` (or `onEnd`).
- Initialize both cameras' `position` from it; set OrbitControls `target` from it (an
  effect after the camera mounts).
- Minimum bar (this is the user's actual complaint): **preserve position + target**.
  Optional polish: keep visual scale matched — ortho visible height ≈ `viewportHeightPx /
  zoom`; perspective visible height at distance `d` ≈ `2·d·tan(fov/2)`. When switching
  to perspective, place the camera at the distance that matches the current ortho
  framing; when switching to ortho, set `zoom` to match the current perspective
  distance. If matching is fiddly, ship position+target preservation and note the scale
  caveat.

**Gotcha:** you likely still need OrbitControls to re-target the new default camera. Try
dropping `key={projection}` first (drei may follow the default camera); if the controls
stop working after a toggle, keep the remount but restore pose in a `useEffect` keyed on
`projection`.

**Verify:** `__pvc.getCameraPos()` already exists (see `DebugBridge` in `Scene.tsx`). In
a browser check: orbit to a non-default view, read `getCameraPos()`, toggle projection
(`__pvc.setProjection`), read again — position should be ~unchanged (small tolerance).

---

## Task 2 — Length-arrow first-move jump (quick)

**Where:** `src/ui/scene/SelectionHandles.tsx` → `LengthArrow` + `useGroundDrag`, and
`src/state/editorActions.ts` → `dragMemberEndLength` (calls
`projectLengthOnAxis(fixedEnd, axisDir, cursor, grid, minLen)`).

**Cause:** the arrow mesh sits *outward* from the pipe end (offset by ~`base`), and the
drag sets the new length to the **absolute** projection of the cursor onto the axis. The
cursor starts over the arrow (past the end), so the first frame snaps the length to that
larger projection → visible jump.

**Fix (grab offset):** track the cursor delta, not the absolute projection.
- At drag start capture `L0` (current member length) and `p0` (cursor's axis projection
  from the first ground point).
- Each move: `L = L0 + (projectRaw(cursor) - p0)`, then grid-snap + clamp (`MIN_MEMBER_LEN_M`).
- Implement by passing a `grabOffset` into `dragMemberEndLength` (or add a variant), or
  capture `p0`/`L0` in a ref inside `LengthArrow` and compute the target length there
  before calling `setNodePosition`-equivalent. Keep the axis (`dir`) captured at grab as
  it already is.

**Verify:** unit-test the math in `dragMath.test.ts` (a helper like
`lengthFromGrabDrag(L0, p0, projNow)`); browser: select a straight pipe, drag the arrow a
small amount and assert the length changes by roughly the drag distance, not by the arrow
offset. There's a `__pvc.dragNode` seam but length-arrow dragging isn't exposed — add
`__pvc.dragMemberEnd(...)` if useful, or just test the pure helper + eyeball.

---

## Task 9 — Tee from a branch onto a pipe (split + form tee)

**Goal:** when a draw/connect endpoint lands on the *middle* of an existing pipe (an
"on-pipe" snap), split that pipe at the point and connect the branch there → the node now
has two collinear run members + one branch = a **tee** (Phase-2 `resolveFittings` already
classifies it, once the node exists).

**Where:**
- `src/design/snapping.ts`: `snapPoint` already returns `kind: 'on-pipe'` but **not which
  member**. Add the member id (and the exact split point) to the on-pipe branch of
  `SnapContext.segments` handling — thread a `memberId` onto each `SnapSegment` and return
  it as `SnapResult.onPipeMemberId`. Cover with a `snapping.test.ts` case.
- `src/design/docOps.ts`: add `splitMemberAt(design, memberId, pos): { design, nodeId }`.
  For a `straight` member A–B: create node N at `pos`, remove the member, add A–N and
  N–B (same size, new ids). (Formed members: skip for v1 — only split straights; if the
  on-pipe hit is a formed member, fall back to a free point. Note it.)
- `src/state/editorActions.ts` → `placeDrawPoint`: when the resolved snap is `on-pipe`
  with an `onPipeMemberId`, first `splitMemberAt` that member at `snap.position`, then
  connect the path to the resulting node (`connectPipe`) — mirroring the existing
  `snap.kind === 'node'` branch.
- The split node is a normal junction → welded in physics/kinematics, and
  `resolveFittings` yields a tee automatically. No fitting code changes needed.

**Verify:** browser/unit — draw a straight run, then draw a branch whose endpoint lands on
its middle; assert the run became **two** members, a new node exists at the branch point,
and `__pvc.getFittings()` reports one `tee`.

**Open question (surface to the user):** "and can't pivot currently." A tee node has 3
members, and a `Pivot` is defined between exactly 2 members (`canPivot` requires degree 2).
So a tee can't become a pivot as-is. Ask the user whether they want (a) just the tee to
form (this task), or (b) a way to hinge the branch relative to the run (a new joint type —
out of scope until clarified). Implement (a); flag (b).

---

## Task 3/1 grouping note

The **move tool** (below) and the **length-arrow fix** both live in
`SelectionHandles.tsx`/`editorActions.ts` and share the `useGroundDrag` + grab-offset
idea. Do the length-arrow fix first, then reuse the grab-offset approach in the move tool.

## Task 1 — Move tool (hotkey `m`) with axis move-arrows

**Goal:** a dedicated tool that shows three **translate arrows** (X red, Y green, Z blue)
on the selected pipe; dragging an arrow translates the whole member (both endpoints)
along that world axis, grid-snapped, one undo step.

**Where:**
- `editorStore.ts`: add `'move'` to the `Tool` union.
- `Pillbox.tsx`: add a Move button (lucide `Move` or `Move3d` icon).
- `EditorShell.tsx` keyboard handler: `m`/`M` → `setTool('move')`.
- `docOps.ts`: `translateMember(design, memberId, delta: Vec3): Design` — move both
  `nodeA` and `nodeB` by `delta` (reuse `setNodePosition` twice, or map nodes). Pure +
  test. (Consider also translating any control points if the member is formed.)
- `editorActions.ts`: `dragMoveAxis(memberId, axis: Vec3, ground, grabOffset)` — project
  the ground point onto the world `axis` through the member's grab origin, grid-snap the
  delta along that axis, and `translateMember`. Use the **grab-offset** pattern from
  Task 3 so there's no first-move jump.
- New scene component (or extend `SelectionHandles.tsx`): render three cone arrows at the
  selected member's (eased) midpoint, one per axis, using `useGroundDrag`. Reuse
  `orientY(dir)` from `scene/axis.ts` to orient each cone. Colors match the gizmo:
  X `#d64545`, Y `#3d9950`, Z `#2a78d6`. Gate rendering on `tool === 'move'` in
  `Scene.tsx` (like `{tool === 'select' && <SelectionHandles/>}`).
- **Y-axis drag caveat:** `useGroundDrag` raycasts the y=0 ground plane, which can't give
  vertical motion. For the **Y** arrow, derive the delta from screen-space vertical
  cursor movement (or intersect a vertical plane through the grab point that faces the
  camera). Document whichever you choose. X/Z arrows use the ground raycast normally.

**Verify:** browser — select a pipe in move mode, drag the X arrow, assert both node x's
shifted by ~the same amount and lengths unchanged; screenshot the 3-arrow gizmo.
Consider a `__pvc.moveMember(id, delta)` seam for headless assertions.

---

## Task 4-of-list #4 wait — Marquee select

## Task — Marquee (rubber-band) select

**Goal:** in the **select** tool, dragging on empty space draws a screen-space rectangle
and selects members by it (multi-select into `editorStore.selectedIds`).

**Where:**
- Left-drag is free (OrbitControls doesn't use LEFT). Detect the marquee in
  `DrawController.tsx` (it already owns the ground-plane pointer + a click-vs-drag slop
  test via `down.current` + `CLICK_SLOP_PX`) OR add a DOM overlay listener in
  `EditorShell`. Recommended: track pointer down/move/up at the DOM level (screen coords)
  and render the rectangle as an HTML overlay div; on release, hit-test.
- **Hit-test:** project each member's endpoints (and a few samples along it) to screen
  using the camera (there's a `__pvc.screenOf(worldPos)` seam pattern in `DebugBridge`;
  reuse the same NDC→pixel math with `camera.project`). A member is:
  - **contained** if all its screen points are inside the rect,
  - **touching/crossing** if any point is inside OR its screen segment intersects a rect
    edge.
  Set `selectedIds` to the matched member ids. `PipeLayer`/`FormedLayer` already highlight
  every id in the set, so multi-select renders for free. `SelectionHandles`/`SelectionPanel`
  currently assume a single selection — either show handles only when exactly one is
  selected, or leave them for a follow-up (note it).
- A tiny drag (< slop) stays a click → clears selection (existing behavior).

**⚠ Open question — direction semantics (confirm with the user):** the user wrote "from
the **left** select anything **touching**, from the **right**: anything **contained**,"
but also "same as SketchUp." **SketchUp/CAD is the opposite:** left→right (drag rightward)
= **window** = *contained only*; right→left (drag leftward) = **crossing** = *touching*.
Implement the standard CAD/SketchUp behavior (left→right = contained, right→left =
touching), and call this out to the user so they can confirm or flip it — it's a one-line
swap. Optionally colour the rect (blue solid for window, green dashed for crossing) like
CAD.

**Verify:** browser — draw a few pipes, drag a rectangle around a subset (left→right),
assert `__pvc.getEditor().selectedIds` contains only the fully-enclosed ones; drag
right→left across some and assert the crossed ones are included. Add a
`__pvc.marquee(x0,y0,x1,y1)` seam if pointer simulation is awkward.

---

## Conventions / definition of done

- Pin exact dependency versions; Biome zero-diagnostics (2-space, single quotes, width
  100). r3f `<mesh onClick>` needs a `// biome-ignore lint/a11y/noStaticElementInteractions`.
- Pure geometry/logic gets **Vitest**; the e2e stays a tiny smoke. Add `__pvc` seams for
  headless verification and **actually run a browser check** (don't just typecheck).
- Update `DECISIONS.md` (newest first) for anything decided, and this repo's `CLAUDE.md`
  "current state" if scope shifts.
- Commit each item with a clear message ending in the `Co-Authored-By` / `Claude-Session`
  trailers already used in the history; push to `main` (origin is
  `github.com:JoeMattie/pvc-builder`). Only commit/push when the gate is green.
- The user is hands-on and cares about feel: verify feel where you can, and flag the two
  open questions (marquee direction, tee-pivot meaning) rather than guessing silently.

## Known adjacent context (don't regress these)

- Physics (`src/solver/physics.ts`) is a **stateful** CrashCat sim used only in Play mode;
  it rebuilds when a topology hash changes. Your edits change the *document* — physics
  picks them up on next Play. Nothing you do here should touch physics.
- Drags must go through `useGroundDrag` (window listeners, no `setPointerCapture`) — a
  previous mesh-capture approach left OrbitControls stuck.
- Node centre-lines live at y=0 (the grid plane); the ground/floor is y=0.
- Left mouse = tools/marquee, middle = pan, right = rotate; context menu is suppressed;
  right-click ends an in-progress path.
