# DECISIONS

Running log of decisions with lasting consequences for PVC Builder. Newest
first. See `docs/planfiles/PLANFILE-pvc-builder.md` for the full plan and
`CLAUDE.md` for conventions.

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
