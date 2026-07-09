# PLANFILE — Overnight batch (elastic bands · docs · Project Raptor)

Author: autonomous session 2026-07-08. Three large tasks, to be done in order
(1 → 2 → 3), deploying to prod (version bump + tag + push) after each shippable
unit. This file is the durable spec so the work survives a context reset. Follow
CLAUDE.md conventions (Zod source of truth + migration per schema bump; pure
docOps; single `editorActions` bridge; `__pvc` seams; Vitest for pure math;
`npm run typecheck && lint && test && build` all green; DECISIONS.md + changelog
per commit-to-main).

Current app version at start of batch: **v0.1.14** (groups). Schema **v7**.

---

## TASK 1 — Elastic band tool (spring member in the physics sim)

**Goal:** a user can add elastic bands between two attachment points (a pipe END
or a point ALONG a pipe), give each a tension via a slider, and see them pull in
the physics simulation. Bands are assumed pre-tensioned (never start slack).

### Schema (v8 — `elastics`)
- New `attachmentSchema = union({nodeId}, {memberId, t})` where `t∈[0,1]` is the
  fraction along a straight member.
- `elasticSchema = { id, a: attachment, b: attachment, restLengthM: number>=0,
  stiffnessNPerM: number>=0 }`.
- `designSchema.elastics: z.array(elasticSchema)` (default []). Bump
  `SCHEMA_VERSION = 8`; migration `7: (doc) => ({...doc, elastics: [...] || []})`;
  `createEmptyDesign` adds `elastics: []`; add a v7→v8 migration test.
- On creation set `restLengthM = drawnLength * 0.6` (pre-tension) and a default
  `stiffnessNPerM` (tune; start ~200 N/m real → scaled in physics). Keep it a
  SPRING (stable equilibrium), not constant-force.

### Pure docOps
- `addElastic(design, a, b, restLengthM, stiffnessNPerM)`, `removeElastic`,
  `setElasticStiffness(design, id, k)`, `attachmentPos(design, att)` (world point
  of an attachment from node/member+t), `elasticLengthM`. Vitest for
  attachmentPos + length.

### Physics (`src/solver/physics.ts`)
- In `build()`, resolve each elastic endpoint to `{bodyId, localOffset}` (reuse
  the `nodeSource`/member→body mapping; for `{memberId,t}` interpolate the point
  on the member and find its assembly body + local offset like nodeSource does).
  Store `sim.elastics = [{aBody, aLocal, bBody, bLocal, restLenM, kScaled}]`.
- Each `stepPhysics`, BEFORE `updateWorld`: for each elastic compute world
  `pa, pb` (`body.position + quat⊗local`, in SCALED space), `len=|pb-pa|`; if
  `len > restLen*SCALE`: `F = k * (len - restLen*SCALE)` (+ axial damping using
  relative velocity), `dir=(pb-pa)/len`; `rigidBody.addForceAtPosition(world,
  aBody, +F·dir, pa, true)` and `-F·dir` at `pb` on bBody. Attach to STATIC
  bodies is a no-op force (fine). Use `mathcat` for the hot loop.
- Expose the elastics to render via eased positions (they follow the pipe).

### Tool + UI
- New `Tool = 'elastic'` (hotkey **E**). Two-click placement like the tape
  measure (`placeMeasurePoint` is the template): click A (snap to end/along
  pipe), click B → create the band. Add `placeElasticPoint` in editorActions +
  a Pillbox button + `__pvc` seams (`setTool('elastic')`, `placeElastic`).
- Selectable band → a tension slider panel (mirror `PivotPanel`/`SelectionPanel`)
  wired to `setElasticStiffness`.

### Rendering (`src/ui/scene/ElasticLayer.tsx`)
- Draw each band from `attachmentPos(a)`→`attachmentPos(b)` at eased positions —
  a thin orange tube or a dashed/zig-zag line (a simple thin cylinder is fine v1).
  Instanced if many (follow the instancing pattern). Selectable (click → select).
- Optional: colour by current stretch (more stretched = brighter/red).

### Done-when: typecheck/lint/test/build green; a band drawn between two pipe ends
visibly pulls them together in Play; tension slider changes the pull; e2e via
`__pvc`. Ship as its own version, update DECISIONS + changelog + CONTEXT cards.

---

## TASK 2 — Technical documentation (then push, then start Task 3)

**Goal:** document ALL features + interface elements/interactions in markdown WITH
screenshots, AND surface docs in the app itself. Push to prod.

- `docs/USER-GUIDE.md`: every tool (Select, Draw, Curve/Bend, Move, Rotate,
  Measure, Elastic), every interaction (snapping, drawing typed lengths, joints
  wrapped/free/anchor/manufactured, groups, copy/paste, nudge keys, units pill,
  lengths-lock + Play/physics + debug overlay, BOM/cutlist + CSV, JSON
  export/import, examples). Enumerate keyboard shortcuts + right-click menus.
- Screenshots: drive the built app headless with Playwright (`__pvc` seams +
  example loads), `page.screenshot()` into `docs/img/`. Cover: main page, an
  example in the editor, the join menu, a wrapped/free joint, groups fade, Play
  with physics-debug overlay, the BOM panel.
- In-app: add a **Help/Docs** panel or a `?` button that shows the shortcut list
  + a link/section (a `HelpPanel.tsx` reachable from the editor toolbar; and a
  "Docs" link on the project-list page). Keep it self-contained (no network).
- Verify (typecheck/lint/build), ship a version, push. Then proceed to Task 3.
- DISPATCHABLE to a subagent (self-contained, low schema risk).

---

## TASK 3 — Project Raptor prototype (loadable templates + mannequin)

**Primary spec:** `docs/RAPTOR-BRIEF.md` (generated by the research subagent —
READ IT FIRST). It maps the costume's mechanisms to our primitives and proposes
the phased skeleton. Also inspect `~/Downloads/raptor-test.riglab.json` for a
concrete skeleton to adapt, and riglab at `/home/joe/dev/riglab`.

Build a PARTIALLY-working prototype: implement the articulations that our
features support; skip the rest (that's fine). It should be balanced enough to
mostly move correctly and hang on a mannequin without falling.

### New feature: static human MANNEQUIN collision body
- A static (non-dynamic) human-shaped body the raptor can rest/collide against so
  it hangs instead of falling to the ground. Important parts: HEAD (clearance),
  SHOULDERS, WAIST, ARMS/LEGS, HAND/FOOT positions.
- Implement as a CrashCat STATIC compound of simple shapes (capsules/boxes/spheres
  for head, torso, limbs) at human proportions (~1.7 m), plus a matching render
  mesh. Toggle it on/off (editor toggle + `__pvc` seam + a doc flag, e.g.
  `design.mannequin?: boolean` — or an editor-only toggle to avoid a schema bump;
  prefer editor-only unless it must persist). Position it at the origin standing
  on the ground. The raptor templates are authored so their mount points sit on
  the mannequin's shoulders/waist.
- Physics: add the mannequin's static bodies to the world in `build()` when
  enabled; enable collision between the moving layer and the mannequin.

### Friction / drag control
- Add a UI SLIDER for joint friction/drag (the existing `PIVOT_FRICTION_TORQUE` /
  `SLIDE_FRICTION_FORCE` in physics.ts, and elastic damping). A global "damping"
  slider that scales these is enough — so the model can be made to settle/move
  correctly. Wire via `setPhysicsTuning`-style seam + a Play-mode control.

### Phased templates (each a separate generator + example JSON, each builds on the
last). Put generators in `scripts/gen-raptor-*.mjs` (like `gen-trex.mjs`), emit
`src/examples/raptor-*.json`, register in `src/examples/index.ts`:
1. **torso/hip core** — the PVC frame that mounts on the mannequin's shoulders +
   waist. The structural root everything hangs from. (`raptor-torso`)
2. **+ tail** — cantilevered off the hip, likely the counterbalance for the
   neck+head; use `wrapped`/`free` pivots down its length + an ELASTIC band for
   spring-return/level-hang. (`raptor-tail`)
3. **+ legs** — two legs to the foot positions; pivots at hip/knee/ankle as the
   brief allows. (`raptor-legs`)
4. **+ neck** — segmented neck cantilevered forward; elastic counterbalance so it
   hangs level against the tail. (`raptor-neck`)
5. **+ head/jaw** — head mass + a jaw pivot if feasible. (`raptor-head` = the full
   raptor.)
- **Balance strategy:** the tail counterbalances neck+head about the hip so the
  assembly hangs ~level on the mannequin. Tune elastic rest-lengths/stiffness +
  pivot friction so Play settles to a plausible pose, not a collapse. Verify each
  phase in Play (headless: check it doesn't sink through the floor / mannequin;
  node positions stay bounded).
- Generic structural ids only; only the display name/description may say "Raptor".
- Respect the render-layer member caps (raise if a phase needs > current cap).

### Execution notes
- DISPATCH per-phase subagents (each phase is a generator + example + a Play
  sanity check), reconciling in `src/examples/index.ts` (a shared choke — do it
  serially or in the parent). The mannequin + friction slider are shared infra —
  build them FIRST (in the parent or one subagent) before the phase agents.
- Deploy after the mannequin+torso land, then after each subsequent phase.

---

## Coordination
- Schema bumps are a choke point — do them serially in the parent, never in two
  parallel agents. Task 1 bumps to v8; Task 3 mannequin ideally editor-only (no
  bump); if the raptor needs elastics (it does) that's already v8 from Task 1.
- After each task: bump `package.json` + `src/changelog.ts` (newest first) + `git
  tag v<x> ` + `git push origin main --tags`; update DECISIONS.md + the relevant
  `CONTEXT.md` cards.
- Handoff: if context runs low, this planfile + DECISIONS + RAPTOR-BRIEF are
  enough to resume. Note progress inline here as tasks complete.

### Progress log
- [ ] Task 1 — elastic bands
- [ ] Task 2 — docs + push
- [ ] Task 3 — raptor (mannequin, friction slider, torso, tail, legs, neck, head)
