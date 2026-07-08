# DECISIONS

Running log of decisions with lasting consequences for PVC Builder. Newest
first. See `docs/planfiles/PLANFILE-pvc-builder.md` for the full plan and
`CLAUDE.md` for conventions.

## Phase 2 — Fitting auto-solve + procedural meshes (2026-07-07)

- **`resolveFittings(design)` is pure and the single source of fitting truth**
  (`design/fittings.ts`) — no three/UI/physics types. Per node it gathers
  incident pipe ends (outgoing unit dir + size) and classifies within a ±3°
  tolerance: coupling/reducer (collinear same/mixed size), 90°/45° elbow, tee
  (collinear run + perpendicular branch, reducing if the branch differs), cross
  (two perpendicular runs); everything else is a **conflict** with a reason.
  Open ends get no auto fitting (caps are opt-in, not applied). Exhaustively
  tested.
- **Elbows are same-size only** (mixed → conflict); tees/crosses allow a
  reducing branch/leg. Reducer take-off dimensions (centre-to-face) are NOT yet
  in `PipeSpec` — added in Phase 5 for the BOM; meshes use proportional sizing.
- **Fitting meshes are procedural + composed** (`ui/scene/fittingMesh.ts`, the
  CAD-swap seam): each incident end → a socket hub (sleeve 1.28× pipe OD) + a
  bell lip; elbows/tees/crosses add a blend sphere. Pure/tested (primitive
  counts + radii). `FittingLayer` renders them in fitting-gray and marks
  conflicts with a translucent red sphere.
- **Types from the doc, geometry from eased positions.** FittingLayer takes the
  fitting TYPE from the snapped document (stable — no flicker mid-drag) but
  recomputes each fitting's position + end directions from the eased render
  positions, so fittings glide with the pipe. Skipped entirely past 200 members
  (the T-rex wireframe stays connector-free).

## Phase 1 — interaction polish (2026-07-07)

- **Snapping is configurable via a floating pill** (`SnapPill`, bottom-left):
  grid increment (default **1/4"**, plus 1/8"/1/2"/1"/Off; metric equivalents
  when the design is metric) and toggles for point-snap and axis-inference. It's
  a **workspace preference** in `editorStore.snap`, persisted to localStorage
  (`prefs`), never in the document. `editorActions` derives all snap tolerances
  from it. `DEFAULT_GRID_M` lives in `design/snapping.ts`.
- **Geometry eases toward snapped positions** (`state/animStore.ts` +
  `<GeometryAnimator/>`): editing writes stepped/snapped node positions to the
  doc, and the viewport shows positions that lerp toward them (~45 ms), so a
  fine grid glides instead of jumping. New nodes snap in place (no fly-in);
  designs over 160 nodes skip easing (the T-rex renders at target, no per-frame
  cost). `buildPipeModel` takes an optional eased-position override; PipeLayer +
  SelectionHandles read the eased map and re-render off an anim tick.
- **Control scheme:** left button is reserved for tools + a future selection
  marquee (never orbits); **middle = pan, right = free rotate** (OrbitControls
  `mouseButtons`), context menu suppressed. **Spacebar → select tool**;
  **right-click ends the current path** (right-drag still rotates). **Shift while
  drawing locks to the nearest world axis from the path start** (forced, beyond
  proximity inference).
- **Velocity-aware wheel zoom** (`<VelocityZoom/>`): a capture-phase wheel
  listener measures wheel speed (smoothed magnitude/ms) and sets
  OrbitControls' `zoomSpeed` before it handles the same event, so a fast flick
  covers ground and a slow scroll stays fine. Verified: same total delta, fast
  ≈1.9× vs slow ≈1.45× zoom.
- **Deferred:** SketchUp-style reference inference — hover a feature to seed
  extra inference directions (from-point axes, parallel/perpendicular) — is not
  built yet; only the basic Shift axis-lock is. Revisit alongside richer
  drawing.

## Phase 1 — Draw straight pipe + realistic render (2026-07-07)

- **Editing is pure `Design → Design` docOps** (`src/design/docOps.ts`) applied
  through `appStore.updateCurrent`, so undo/autosave stay centralized. Nodes are
  shared junctions: dragging a node moves every incident member; `deleteMember`
  prunes only the nodes it orphans.
- **Snapping is one pure function** (`src/design/snapping.ts`) with a fixed
  priority: existing node → on-pipe point → axis inference from the path start →
  world grid → free. Axis inference grid-quantizes the length *along* the locked
  axis (so on-axis draws land on exact dimensions). Tolerances are world-metre
  (1" grid, 20 mm point radius, 30 mm axis corridor) — good enough at rig scale;
  screen-space tolerances can come later if zoom range demands it.
- **The tools and the `__pvc` hook call ONE action layer**
  (`src/state/editorActions.ts`): `placeDrawPoint` / `dragNodeTo` / `snapDraw…`
  bridge snapping + docOps + stores, so a scripted check drives exactly what the
  pointer drives. New seams: `draw`, `snap`, `finishPath`, `selectMember`,
  `clearSelection`, `setMemberLength`, `dragNode`, `getMembers`, `setDrawSize`.
- **Ground-plane interaction model.** Drawing and dragging both raycast the
  y = 0 plane (`rayToGround`); node centrelines live on the grid plane. A single
  full-bleed plane in `DrawController` doubles as the pointer target and the
  shadow catcher.
- **Shadows via a shadow-map + `shadowMaterial` catcher, not drei
  `ContactShadows`.** A coincident invisible picker plane confuses
  ContactShadows' whole-scene depth pass; a `shadowMaterial` ground plane only
  renders shadowed fragments, so it grounds the pipe *and* is a clean r3f pointer
  target. Still no network (drei `Environment` presets remain out — Phase 0).
- **Click vs orbit-drag** is disambiguated by pointer travel (< 6 px screen =
  place a point; more = the OrbitControls drag). Endpoint drags suspend
  OrbitControls and batch into one undo step via `begin/endGesture`.
- **Direct-manipulation resize (revised):** a selected pipe shows two kinds of
  handles at each end — an outward **length arrow** (cone) that resizes along
  the pipe's own axis (opposite end fixed, grid-snapped, live label), and an
  **endpoint grab sphere** that free-moves the junction on the ground, with
  **Shift to lock to a world axis**. The drag math is pure/tested
  (`design/dragMath.ts`: `projectLengthOnAxis`, `lockToNearestAxis`); the
  numeric length field stays as the precise alternative.
- **Handle drags use window pointer listeners, not mesh events.** r3f only
  sends a mesh pointermove/up while the ray intersects it, so a mesh-driven drag
  stopped — and its "re-enable OrbitControls" pointerup never fired — the moment
  the cursor left the small handle, leaving the camera stuck (and fighting a
  leftover `setPointerCapture`). `useGroundDrag` (SelectionHandles) now suspends
  OrbitControls on pointer-down and drives move/up from `window` listeners
  (raycasting the ground each move), guaranteeing the pointer-up re-enables
  controls anywhere. No `setPointerCapture`.
- **Bundled examples + a mesh-import path.** `src/examples/` holds baked Design
  JSON offered from the project list (`appStore.createFromExample`). The first
  is a **T-rex wireframe** — a low-poly STL turned into pipe by
  `scripts/gen-trex.mjs` (edges → straight members, vertices → nodes, welded;
  remapped Z-up→Y-up, rested on the ground, scaled to ~1.8 m; no fittings). It
  doubles as a render stress test (262 nodes / 780 pipes). Generated JSON +
  one-off scripts are excluded from Biome.
- **Drag performance:** the scene graph must not re-render on every drag frame.
  `Scene` does NOT subscribe to the document; `PipeLayer`/`SelectionHandles`/
  `DrawController` read it (or narrow slices) themselves, and `EditorShell`
  subscribes to fields (name/lengthsLocked), so a drag only re-renders the pipe
  + handle layers, not the grid/gizmo/cameras/lights. Shadow map is 1024² and
  the Canvas uses `shadows="percentage"` (PCFShadowMap) — avoids three 0.185's
  `PCFSoftShadowMap` deprecation warning and is cheaper. (The remaining
  `THREE.Clock` deprecation is emitted inside @react-three/fiber's loop, not our
  code.)
- **Pipe material** is `meshPhysicalMaterial` (white PVC, roughness 0.38, faint
  clearcoat). Cylinders at true OD from `PipeSpec`; a rounding sphere at each
  junction sized to the thickest incident member.
- **Pillbox = tool (select/draw) + active draw size.** The two size buttons pick
  the active `drawSize` (editor state); `design.enabledSizes` stays both.
  Keyboard: V/B tools, Esc/Enter finish path, Delete removes selection, ⌘/Ctrl+Z
  undo.

**State at end of Phase 1:** typecheck / lint / **73 unit+integration tests** /
build all green; a headless-chromium smoke against the built app confirms the
WebGL scene mounts, a 3-pipe path drawn through `__pvc` preserves segment
lengths within 1e-6 m at correct OD, length-edit + selection + perspective
toggle work, and the console/network is error-free.

## Phase 0 — Scaffold & stack (2026-07-07)

Already-made decisions carried in from the planfile (§10), recorded here at the
first commit as instructed:

- **Renderer = three.js + @react-three/fiber + @react-three/drei** (over
  Babylon / PlayCanvas): React-first ergonomics and reuse of riglab's rendering
  approach. drei supplies the camera/orbit/grid/gizmo primitives.
- **Physics = CrashCat behind the `solve()` boundary** (arriving Phase 4). Its
  determinism is untested upstream, so pivot math will be acceptance-tested
  against closed-form (arc/angle/length-preservation), not trusted from the
  engine. Not yet a dependency — added when Phase 4 lands.
- **Fittings = procedural from ASTM dimensions** (`PipeSpec` table), with a
  `FittingMesh` seam left for swapping in real CAD later; not built in v1.
- **Mixed 1/2" + 3/4" allowed**, resolving to auto reducer fittings (Phase 2).
- **Pivots driven by both drag and angle sliders** (Phase 4).

Scaffold-specific decisions:

- **Stack mirrors riglab with pinned exact versions** (React 19.2, Vite 8.1,
  TS 6.0, Biome 2.5, Tailwind v4, three 0.185, zustand 5 + zundo + immer, Zod 4,
  Dexie 4). Config (`tsconfig`, `vite.config`, `biome.json`, `components.json`,
  shadcn token block in `index.css`) copied and adapted. Pure math
  (`geometry/math3.ts`, `geometry/pipe.ts`) and `ui/units.ts` copied **verbatim
  with their tests**.
- **riglab-only deps dropped**: konva/react-konva (riglab's 2D sketch canvas —
  PVC Builder is 3D-only), planck/rapier (riglab's physics — replaced by
  CrashCat later). Added: three + @react-three/fiber + @react-three/drei +
  @types/three.
- **Design schema v1 = nodes + straight members only** (planfile phasing).
  Formed (spline) members land Phase 3 and pivots Phase 4, each as a
  `SCHEMA_VERSION` bump + migration. The migration registry is empty at v1; the
  runner (`applyMigrations`/`migrateToLatest`, copied from riglab) is already
  covered by tests so the first real migration has a proven harness.
- **`PipeSpec` seeded with OD / wall / socket depth only** for 1/2" and 3/4"
  (ASTM D1785 / D2466). Elbow/tee/cross centre-to-face take-offs are left
  optional and filled in Phase 2 from Spears tables rather than fabricated now.
- **No `Environment` IBL preset in the viewport.** drei's `Environment` presets
  fetch an HDR over the network; the planfile forbids runtime network. Phase 0
  uses ambient + hemisphere + directional lights. A local/bundled IBL can be
  added in Phase 1 if the plastic look needs it.
- **Theme kept lean.** riglab's large `theme.ts` chrome-token system is not
  copied; `ui/theme.ts` only toggles the shadcn `.dark` class and exposes a
  small `scenePalette()` for the three.js-side colors (which can't read CSS
  vars).
- **Playwright deferred to Phase 5.** The `e2e` script and `@playwright/test`
  dep are present, but no config/tests yet (planfile puts the smoke suite in
  Phase 5). Phase 0 verification is Vitest + a served-build HTTP smoke.
- **Debug hook is `window.__pvc`** (merge-not-replace), exposing `getDoc`,
  `getEditor`, `setTool`, `setProjection`, `setLengthsLocked`, `setNight` so
  far; more seams (`resolveFittings`, `getSolve`, `loadExample`, …) are added as
  their phases land.

**State at end of Phase 0:** `typecheck`, `lint`, `test` (41 passing), and
`build` all green; the built app serves and mounts; create/open/rename/delete a
design through the Dexie-backed store (covered by tests); 3D viewport renders an
iso ortho stage with ground grid + axis gizmo and a one-click perspective
toggle; `window.__pvc.getDoc()` installed.
