# PVC Builder Recommendation Review (historical)

> Status: retained as a dated audit, not a list of current gaps. Workflow tabs, persistent
> semantics, stock planning, revision UI, interaction tests, context refreshes, and much of the
> shell extraction described below have since shipped. Current mobile/runtime work is tracked in
> `docs/planfiles/PLANFILE-mobile-and-hardening.md`.

Date: 2026-07-09  
Scope reviewed: product docs, schema/design core, state/action layer, React chrome, R3F scene, persistence, examples, and tests.  
Constraint followed: no app/build/test execution; this review is based on static file inspection only.

## Executive Summary

PVC Builder is well past a simple prototype. The core architecture is strong: Zod owns the file format, geometry/fittings/BOM/solver logic are mostly pure and well tested, and the R3F scene has already been optimized around instanced rendering and imperative per-frame updates. That is a solid base for a serious browser CAD tool.

The largest gap is product shape, not raw capability. The editor has accumulated many high-value systems, including groups, heat bends, elastic bands, physics, mannequin support, cut lists, examples, measurements, import/export, and multiple joint types. Those systems currently surface as independent floating controls and right-click behaviors. The result is powerful but hard to scan, hard to learn, and harder than necessary to trust for fabrication.

Highest-impact improvements:

1. Reorganize the editor around workflows: Design, Inspect/Fabricate, Simulate.
2. Make visual semantics persistent: size, joint type, fabricated vs manufactured, warnings, and simulation state should be visible without hover/title text.
3. Replace estimated fabrication constants with source-backed fitting tables and expose confidence/warnings in the BOM.
4. Split the React shell and action layer before they become the next bottleneck.
5. Add real pointer/keyboard Playwright coverage for the CAD interactions that `window.__pvc` cannot validate.
6. Refresh context docs; the repo depends on documentation as navigation, and several orientation files now lag the implementation.

## What Is Working Well

### Architecture

The architecture matches the repo's stated principle: pure cores behind narrow interfaces. `docs/CODE-MAP.md:10` describes the intended dependency flow, and the implementation broadly follows it. `resolveFittings`, `bom`, formed-pipe analysis, snapping, intersections, migrations, and the solver are largely isolated from React/three concerns.

The schema layer is disciplined. `src/schema/design.ts:34` has `SCHEMA_VERSION = 10`, migrations are explicit in `src/schema/migrations.ts:10`, and imports/DB loads both pass through validation and migration. That is the right foundation for a local-first CAD file format.

The state split is also sound. `src/state/appStore.ts:29` centralizes document mutation through `updateCurrent`, while `src/state/editorStore.ts:38` keeps transient tool state out of persistence and undo. Gesture batching in `src/state/appStore.ts:172` is exactly the right pattern for CAD drags.

### Rendering And Performance

The scene has been deliberately optimized. `src/ui/scene/PipeLayer.tsx:38` renders pipe bodies through one instanced mesh, and `src/ui/scene/FittingLayer.tsx:76` does the same for fitting primitives and conflict markers. `src/ui/scene/Scene.tsx:90` deliberately avoids subscribing the scene root to the document, preventing full scene churn during drags.

This is a good React-three architecture: React builds structure; `useFrame` updates transforms. Keep that strategy.

### CAD Feature Surface

The interaction model contains several strong CAD affordances:

- CAD window/crossing marquee semantics in `src/ui/EditorShell.tsx:95` and `src/ui/scene/DrawController.tsx:340`.
- Endpoint handles, length arrows, axis-aware resize, and height pills in `src/ui/scene/SelectionHandles.tsx:180` and `src/ui/scene/SelectionHandles.tsx:275`.
- Snap badges and pipe outlines in `src/ui/scene/DrawController.tsx:53`.
- Exact typed length parsing in `src/ui/EditorShell.tsx:268` and `src/ui/units.ts:140`.
- Group-aware selection and deferred union behavior in `src/state/editorActions.ts:357` and `src/design/docOps.ts:1321`.

These are not trivial features. The main need is to make them easier to discover, trust, and verify.

## Priority Recommendations

## 1. Reframe The Editor Around Workflows

Current state: `src/ui/EditorShell.tsx` owns the whole editor screen, keyboard system, import/export, debug bridge, `window.__pvc`, and every floating panel. The render tree places controls in at least six independent viewport regions: top-left project/BOM/import/export, top-center selection/Bend/Band panels, bottom-center tools, bottom-left snap/units, top-right simulation/view/theme/lock/help, and right-side pivot panel (`src/ui/EditorShell.tsx:523` through `src/ui/EditorShell.tsx:749`).

Recommendation: organize the UI into three first-class workflows.

- **Design:** draw, select, move, rotate, bend, group, snap, size.
- **Inspect/Fabricate:** object tree, measurements, fitting diagnostics, BOM, cut settings, export.
- **Simulate:** length lock, pivots, bands, mannequin, damping, physics debug, reset/settle controls.

Implementation direction:

- Replace the current all-at-once floating toolbar cluster with a left vertical tool rail plus a right contextual inspector.
- Keep transient viewport badges in the scene, but move persistent state controls into stable panels.
- Make the top bar show document name, save state, units, warning count, and mode.
- Move import/export/BOM/history into a document menu or Fabricate workspace.
- Leave the viewport as the primary canvas; avoid adding more floating panels.

Why this matters: the product now has more modes than a single pillbox can carry comfortably. The intended principle in `docs/planfiles/PLANFILE-pvc-builder.md:12` is speed and feel. The current UI can still be fast for the author, but it asks new users to remember too much.

## 2. Add Persistent Visual Semantics

Current state: the theme is almost entirely neutral grayscale in `src/index.css:6` and `src/ui/theme.ts:15`. Pipe bodies and fittings are visually close, and many mode meanings live in hover titles or help text. Conflicts are red (`src/ui/scene/FittingLayer.tsx:177`, `src/ui/scene/IntersectionLayer.tsx:25`), but the viewport does not explain what is wrong unless the user opens another surface.

Recommendation: introduce a restrained CAD legend and persistent semantic styling.

Suggested encodings:

- Pipe size: subtle stripe/ring or end-band, not a loud full-body color.
- Joint type: consistent icons/color chips for Anchor, Wrapped, Free, Manufactured.
- Fabrication class: manufactured socket fitting vs fabricated wrap/bolt should be visually distinct.
- Warning severity: conflict, intersection, tight bend, estimated BOM, simulation-only assumption.
- Simulation state: show when physics positions are active versus document geometry.

Specific UI changes:

- Add hover/selection popovers that show fitting type, joint mode, receiver/mover, size, cut length, and warning reason.
- Add persistent warning badges in the object tree and BOM rows.
- Add a small legend toggle in Inspect/Fabricate mode.
- Avoid relying on `title` only; many buttons use titles, such as `src/ui/EditorShell.tsx:547`, `src/ui/EditorShell.tsx:675`, and `src/ui/JoinMenu.tsx:81`, but title text is weak on touch devices and inconsistent for accessibility.

## 3. Turn The BOM Into A Fabrication Workflow

Current state: the BOM core is strong but the UI is still a compact output drawer. `src/design/bom.ts:20` explicitly says center-to-face factors are estimates, and `src/design/bom.ts:40` says wrapped-union allowances are estimates. `src/schema/pipeSpec.ts:20` has optional center-to-face fields, but they are not populated. `src/ui/BomPanel.tsx:52` shows only Pipe, Size, and Cut length, while the CSV contains more fields at `src/design/bom.ts:288`.

Recommendation: move fabrication from “export table” to “shop-ready workflow.”

Add:

- Source-backed manufacturer fitting tables for each supported fitting and size.
- A user-visible “estimate/source” status for each take-off and allowance.
- Stock length planning: common 5 ft / 10 ft sticks, waste, cut grouping, and remainder tracking.
- Kerf/cut tolerance settings.
- Optional end caps/open ends. The original plan lists caps in `docs/planfiles/PLANFILE-pvc-builder.md:32`, but `resolveFittings` currently treats one incident end as no fitting at `src/design/fittings.ts:106`.
- Printable cut tickets with pipe label, length, size, member id, segment id, bend schedule, and notes.
- A visual “label pipes” mode that overlays P1/P2/etc. in the viewport matching `src/ui/BomPanel.tsx:67`.

For heat-formed members, surface the bend schedule in the UI, not only in the core data. `src/design/formed.ts:49` computes bend details, and `src/design/bom.ts:205` includes bend radians, but `src/ui/BomPanel.tsx` does not show bend radius, deflection, or bend-plane rotations.

## 4. Strengthen Joint Authoring And Constraint Feedback

Current state: right-click opens `JoinMenu`, which is useful and context-aware (`src/ui/JoinMenu.tsx:19`). But joint semantics are not visible enough. Receiver/mover choice matters deeply for wrapped pivots and fabricated lengths, yet the UI mostly hides it behind a swap icon (`src/ui/scene/JointLayer.tsx:367`) or a small inspector button (`src/ui/SelectionPanel.tsx:151`).

Recommendations:

- Make joints first-class rows in `ObjectTree`, not just scene hardware.
- On selecting a joint, show a proper inspector: mode, receiver, mover, on-body/end-to-end, manufactured flag, angle, limits, hardware, BOM effect.
- Visualize receiver/mover with directional arrows in the scene during hover/selection.
- Explain consequences in the menu: “manufactured tee cuts this run” vs “fabricated wrap leaves run intact.”
- Use physical/screen-space thresholds for right-click near-end detection instead of `0.25 * member length` in `src/ui/scene/PipeLayer.tsx:142`; the current heuristic can be too broad on long pipes and too narrow on short fittings.
- Expose `joint.limits` from `src/schema/design.ts:106` in the UI. `PivotPanel` currently hardcodes -180 to 180 degrees at `src/ui/PivotPanel.tsx:81`.
- Add free-joint orientation controls or at least a reset/inspect control. Free joints are drag-only today (`src/ui/PivotPanel.tsx:94`), which makes exact repeatability difficult.

Also fix shortcut drift: `src/ui/HelpPanel.tsx:64` says `R` resets pivots, but `src/ui/EditorShell.tsx:326` maps `R` to the Rotate tool. That is a direct UX/documentation mismatch.

## 5. Improve CAD Precision Controls

Current state: snapping is useful, but precision workflows are still basic. Grid options live in `SnapPill` (`src/ui/SnapPill.tsx:7`), typed segment length is supported (`src/ui/EditorShell.tsx:268`), and transform gizmos exist. There is no general numerical transform panel, coordinate input, construction line, workplane manager, or constraint list.

Recommendations:

- Add numeric position fields for selected nodes/endpoints and numeric delta fields for Move/Rotate.
- Add copy/move by vector, rotate by exact angle, and align/distribute tools.
- Add construction geometry: temporary axes, guide points, projected intersections, and lockable reference planes.
- Add a snap priority/status readout. `src/design/snapping.ts:7` defines node -> on-pipe -> axis -> grid -> free priority; users should be able to see what won and why.
- Make snap tolerances more consistently screen-space. The scene has screen-space picking in `src/ui/scene/DrawController.tsx:140`, but the pure snap layer still uses fixed world radii at `src/design/snapping.ts:133`. At different zoom levels, fixed-world tolerances can feel inconsistent.
- Add selection filters for pipes, joints, dimensions, elastics, and groups.

## 6. Clarify Simulation Trust Boundaries

Current state: simulation is powerful and visually impressive, but it mixes qualitative design exploration with physical-looking output. The solver context explicitly notes limitations: pipe-vs-pipe collisions are disabled and physics is scaled (`src/solver/CONTEXT.md:45`). The UI exposes Play, Damping, mannequin, and debug toggles, but not the assumptions.

Recommendations:

- Add a Simulate mode banner: “qualitative motion preview, not load/stress analysis.”
- Add reset-to-design, pause, step, settle, and replay controls.
- Show center of mass, lowest point, ground clearance, and current warning count during Play.
- Separate simulation tuning from document fabrication state where possible. `jointDamping` is document-stored at `src/schema/design.ts:207`; that is useful for examples, but users should understand it is a sim parameter, not a physical part.
- Add collision assumption toggles/status: ground, mannequin, pipe-pipe disabled/enabled if ever added.
- Preserve a clear distinction between document geometry and live physics positions. `src/ui/scene/Scene.tsx:312` steps physics and renders physics node positions; the UI should make that state explicit.

## 7. Split The React Shell Before It Hardens Further

Current state: `src/ui/EditorShell.tsx` is doing too much. It defines global hotkeys (`src/ui/EditorShell.tsx:201`), right-click suppression (`src/ui/EditorShell.tsx:337`), document viewport restore/persist (`src/ui/EditorShell.tsx:162`), import/export, toolbar rendering, `window.__pvc` (`src/ui/EditorShell.tsx:356`), and all top-level panels.

Recommendation: split it into composable units without changing behavior.

Suggested extraction:

- `useEditorHotkeys()` for keyboard and pointer-global behavior.
- `PvcAutomationBridge` for `window.__pvc` registration.
- `DocumentViewportPersistence` for camera/tool restore and persistence.
- `EditorTopBar`, `ToolRail` or `ToolDock`, `StatusBar`, `ModePanels`.
- Tool-specific controller hooks for draw, measure, elastic, bend, selection.

Benefits:

- Hotkey/help mismatch becomes easier to test.
- `window.__pvc` stays a clear API instead of hidden in a render shell.
- Future workflow reorganization becomes lower risk.
- Component-level visual review gets easier.

## 8. Introduce Shared Interaction Utilities

Current state: there are multiple imperative window-listener drag systems. `useGroundDrag` in `src/ui/scene/SelectionHandles.tsx:43` is well explained, and `DrawController` has a separate window-listener path at `src/ui/scene/DrawController.tsx:253`. Pipe bending has a third custom drag path in `src/ui/scene/PipeLayer.tsx:179`.

The decision is understandable: R3F pointerup can be lost when the ray leaves the mesh. But the duplication increases bug risk.

Recommendations:

- Promote `useGroundDrag` into a shared `scene/interactions` module.
- Support projection strategies: ground, view plane, axis line, arbitrary plane.
- Support shared modifier tracking, click slop, gesture batching, controls disable/restore, pointer cancel cleanup.
- Unit-test pure projection math; browser-test pointer lifecycle.
- Use the same utility for selection handles, draw click-drag, bend, measure offset, and elastic rubber banding.

## 9. Add Browser Interaction Tests, Not Just Scripted State Tests

Current state: there are many unit tests and one Playwright smoke (`e2e/smoke.spec.ts`). The smoke is valuable, but it explicitly drives `window.__pvc` rather than real gestures (`e2e/smoke.spec.ts:3`). That validates state contracts but not CAD interaction feel.

Recommendations:

Add a small real-browser interaction suite:

- Draw via actual pointer down/move/up and verify snap badge/geometry.
- Type exact length while drawing and verify the segment length.
- Right-click a junction and choose Wrapped/Free/Manufactured from the DOM menu.
- Drag endpoint with Shift axis lock and Ctrl detach/re-weld.
- Use marquee left-to-right and right-to-left.
- Open BOM and verify pipe labels match viewport labels.
- Take screenshots at desktop and narrow/mobile widths to catch toolbar overlap.
- Add canvas pixel checks for nonblank scene, visible pipes, conflict markers, and simulation/debug overlay.

Keep the existing `window.__pvc` smoke as the fast deterministic suite, but do not rely on it as the only e2e coverage for a CAD editor.

## 10. Use The Existing Revision Store In The Product

Current state: persistence stores rolling revisions (`src/persistence/db.ts:4`, `src/persistence/projectStore.ts:38`), but the UI exposes only create/open/delete/import/export. There is no visible save state, restore history, rename UI, duplicate, or delete confirmation in `src/ui/ProjectList.tsx:180` and `src/ui/ProjectList.tsx:238`.

Recommendations:

- Show autosave state in the editor top bar. `saveState` exists in `src/state/appStore.ts:15` but is not surfaced.
- Add rename, duplicate, and restore previous revision.
- Add project thumbnails/previews using a lightweight scene snapshot or generated icon.
- Add delete confirmation or undo for project deletion.
- Add import on the project list, not only inside an open editor.
- Add “export all projects” for local-first data confidence.

## 11. Improve Project List Information Architecture

Current state: `ProjectList` mixes project management, examples, changelog, guide, theme, and technology stack (`src/ui/ProjectList.tsx:154` through `src/ui/ProjectList.tsx:255`). The “Built with” panel is useful for a developer audience but is secondary to the user’s project workflow.

Recommendations:

- Separate Examples from Projects with tabs or a two-column library layout.
- Add example thumbnails, complexity, features demonstrated, and estimated performance cost.
- Move “Built with” behind an About link unless the page is intentionally developer-facing.
- Surface recent projects first with search/filter.
- Provide a “New from template” flow rather than one-click creating many similarly named examples.

## 12. Refresh Documentation And Context Files

The repo uses context docs as a working contract, so drift is costly.

Specific drift found:

- `docs/CODE-MAP.md:20` and `docs/CODE-MAP.md:36` say schema v9; code is v10 in `src/schema/design.ts:34`.
- `src/schema/CONTEXT.md:11` says `SCHEMA_VERSION=9`; code is v10.
- `src/schema/CONTEXT.md:27` describes migration chain only through v9; code includes v10 group color.
- `src/examples/CONTEXT.md:31` says wrapped-joint hardware is not instanced; current scene context and code show `InstancedWrapJoints` exists.
- `src/examples/CONTEXT.md:3` says generic subjects only, while current examples intentionally include T-rex/Raptor display names.
- `docs/planfiles/PLANFILE-pvc-builder.md:46` says real dynamics are non-goal, but the app now has CrashCat rigid-body simulation, bands, mannequin collision, damping, and debug render.
- `src/ui/HelpPanel.tsx:64` says `R` resets pivots, while `src/ui/EditorShell.tsx:326` maps `R` to Rotate.

Recommendation: add a lightweight documentation drift check to CI or a scripted “context audit” checklist when schema/context files change.

## 13. Tighten Data And Performance Indexing

Current state: many pure functions use `array.find` lookups such as `nodeById` (`src/design/docOps.ts:36`) inside loops. This is fine for current models, and dense rendering has already been optimized, but computational features are expanding: fitting resolution, intersections, BOM, simulation topology, object tree, labels, diagnostics.

Recommendations:

- Add an optional `DesignIndex` helper with node/member maps, incident member maps, group maps, and joint maps.
- Use it in hot analyses such as fittings, intersections, BOM, render spec generation, and object tree derivation.
- Keep public pure APIs simple: accept `Design`, build an index internally when needed, and expose lower-level indexed helpers for batch callers.
- Avoid repeated structural string signatures like `src/ui/ObjectTree.tsx:39` becoming the pattern for large derived UI. Prefer explicit memoized selectors or shared derived indexes.

## 14. Accessibility And Touch Readiness

Current state: many buttons have `aria-label`, which is good. However, the editor depends heavily on hover titles, right-click, small icon buttons, and keyboard shortcuts. These are weak on touch and can be difficult for assistive tech.

Recommendations:

- Replace important `title`-only explanations with Radix tooltips and inspector text.
- Add a command palette for keyboard and discoverability.
- Add a visible shortcut map generated from the same source as hotkeys.
- Increase minimum hit targets for small top-right buttons and scene HTML buttons.
- Add focus management for modals and menus. `HelpPanel` is currently a custom modal at `src/ui/HelpPanel.tsx:114`; Radix Dialog would improve focus trapping and escape behavior.
- Add non-right-click alternatives for join and size menus.

## Suggested Roadmap

### Next 1-2 Weeks

- Fix shortcut/help/docs drift, especially schema v10 references and `R` behavior.
- Add selected-joint inspector with receiver/mover and BOM consequence.
- Surface save state and warning count in the editor.
- Add BOM warnings for estimated take-offs and tight bends.
- Extract `useEditorHotkeys` and `PvcAutomationBridge` from `EditorShell`.
- Add one real pointer Playwright test for draw + typed length.

### Next Month

- Introduce Design / Inspect-Fabricate / Simulate workspaces.
- Add viewport pipe labels matching BOM cut rows.
- Add manufacturer-backed take-off tables and fitting source metadata.
- Add revision restore UI.
- Consolidate drag interaction utilities.
- Add screenshot/pixel regression for editor layout and scene visibility.

### Later

- Stock optimization and printable shop sheets.
- Workplanes, construction geometry, coordinate input, and transform panels.
- Joint limits UI and richer mechanism diagnostics.
- Optional CAD asset swap for fittings through the existing `fittingMesh` seam.
- Deeper simulation controls and clearer physical assumption reporting.

## Bottom Line

PVC Builder has the right technical spine. The next improvements should not be more isolated tools. They should make the existing power legible: workflow-level organization, persistent visual semantics, fabrication-grade data, and interaction tests that protect the feel of the editor.
