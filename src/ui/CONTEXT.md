# src/ui — React chrome (the impure outer layer)

Panels, toolbars, and the app router. Two stores wired throughout: `../state/appStore` (persisted
document) and `../state/editorStore` (transient UI); most panels call thin creators in
`../state/editorActions`. Display units convert at the boundary via `./units` — **internal is SI**.
The 3D rendering layer is the separate `scene/` subdirectory (see `scene/CONTEXT.md`).

## Component hierarchy
`App` (root, from `main.tsx`) → `ProjectList` when no `current`, else `EditorShell`. `EditorShell`
renders `scene/Viewport` as the base layer, mounts `editor/PvcAutomationBridge`, then docks viewport
chrome in draggable `chrome/FloatingIsland` wrappers.

## Files

| File | Responsibility | Notes |
|---|---|---|
| `App.tsx` (15) | Top-level router (projects vs editor) | runs `refreshProjects()` on mount |
| `EditorShell.tsx` | Editor screen — hosts viewport + all floating chrome, restores/persists doc viewport state | **narrow field subscriptions on purpose**; `useResponsiveLayout()` derives compact/short/very-narrow chrome and visual viewport sizing |
| `chrome/` | Shared editor chrome wrappers | `FloatingIsland` provides top/inline title chrome, collapse, title-bar drag/resize, saved positions/sizes/collapse (sizes only apply when `resizable`), magnetic edge snapping (`snapFloatingPos` — panels MAY overlap; no overlap avoidance), workspace reset, viewport clamping, `draggable={false}` pinning (no handle, no saved pos), measured default stacks (`stackId`+`stackOrder` place non-user-moved panels under lower-order peers; mount + reset run a double rAF "settle" pass), a `bottom-right` placement, and `defaultCollapsed` (start collapsed when no collapse state is saved — reset restores it). Inline title text is icon-only below `lg`. Pure helpers tested in `FloatingIsland.test.ts` |
| `editor/` | Extracted editor-shell helpers | workflow/status chrome, simulation panel, global hotkeys, and `PvcAutomationBridge` for `window.__pvc`; read `editor/CONTEXT.md` before editing |
| `BomPanel.tsx` | Cut-list / BOM panel + CSV download | lengths via `formatLength(m, units)`; cut rows dominate — assumptions/sources are a collapsed-by-default `<details>` disclosure at the bottom |
| `SelectionPanel.tsx` | Selection inspector (workflow panel Design tab) — single member: editable length, bend warnings, joint-mode controls; multi-select: summary + size/kind length breakdown; selected joint: stacked `JointInspector` card | controlled draft string synced from geometry; layouts sized for the ~22rem panel body |
| `PivotPanel.tsx` (101) | Locked-mode pivot controls — mobility readout + per-wrapped-joint angle slider | free joints get no slider (posed by dragging) |
| `ElasticPanel.tsx` (—) | Selected elastic-band controls — tension (stiffness) slider + current/rest span + delete | shown when `selectedElasticId` set; drives `setElasticTension` |
| `Pillbox.tsx` | Tool + size pillbox + Group/Ungroup + "Drag lock" (`design.lengthsLocked`) toggle | horizontal/vertical layouts (`editorStore.toolPaletteLayout` + a toggle button); `compact` prop = icons-only vertical rail (labels `sr-only`, no kbds, no layout toggle) for phone chrome; horizontal wraps, labels ≥lg, hotkey kbds ≥2xl; its island is non-resizable/content-sized so every button stays visible; sizes hardcoded `['1/2"','3/4"']` |
| `ObjectTree.tsx` | Left-side tree of pipes + groups — click/Ctrl-click selects, grouped click auto-enters the group, per-group colour swatch/picker | subscribes to a STRUCTURAL doc signature (not positions) so a drag doesn't churn the list |
| `HelpPanel.tsx` (—) | Self-contained modal help / keyboard-shortcut reference (no network) | opened by the editor `?` button (EditorShell top-right) + the ProjectList "Guide" button; keep the shortcut list in sync with `editor/useEditorHotkeys.ts` |
| `ConfirmDialog.tsx` | Small Radix AlertDialog confirmation primitive | used for destructive project delete flow; prefer this over native `window.confirm` |
| `JoinMenu.tsx` (120) | Right-click join menu (Anchor/Wrapped/Free) — opens only at a shared junction / joint hardware | options gated by `joinContext` geometry |
| `SizeMenu.tsx` (—) | Right-click size switcher (1/2"↔3/4") for a pipe or the whole multi-selection | opens on a pipe body / lone end; drives `setMembersSize` |
| `SnapPill.tsx` (133) | Bottom-left snap settings (grid + toggles) | Radix portal-backed menu so it is not clipped by floating chrome; grid options are unit-dependent |
| `ProjectList.tsx` (103) | Landing screen — create/open/delete + grouped examples + a "Guide" (help) button | examples are display-grouped Basic/Raptor/T-Rex; changelog shows two newest versions until "Show older versions" is opened |
| `ViewMenu.tsx` | Camera view preset dropdown | Radix portal-backed so it is not clipped by floating chrome overflow |
| `units.ts` | Compatibility barrel for neutral `../units.ts` conversion + `formatLengthDisplay`/`parseLength` | ⚠ everything stored is SI; pure cores import the neutral module, never UI |
| `UnitsPill.tsx` (—) | Display-units picker → writes `design.lengthDisplay` | display-only; default decimal inches; Radix portal-backed dropdown so island overflow can't clip it |
| `theme.ts` (40) | Day/night — toggles `.dark` + supplies **literal three.js scene colors** | three.js can't read CSS vars; edit scene colors HERE |
| `lib/download.ts` (—) | Client-side file download (no network) | `downloadFile(name, content, mime)` |
| `lib/utils.ts` (—) | shadcn `cn()` className helper | — |

## Depends on
`../state/*`, `../design/*` (bom, docOps, fittings, formed, intersections), `../solver`,
`../solver/physics`, `../persistence/exportImport`, `../geometry/math3`, `../schema`, `./scene/*`.

## Read before editing
- **`window.__pvc` is a public contract** (registered in `editor/PvcAutomationBridge.tsx`) — E2E and scripted checks
  depend on the exact method names/signatures. Treat as API. See `../state/CONTEXT.md` for the list.
- **`EditorShell` subscribes to individual scalars, not the whole doc** (comment lines ~89-90) so
  per-frame drag mutations don't re-render the chrome. Preserve when adding state.
- **Floating workspace chrome is user-positioned** via `chrome/FloatingIsland.tsx`. New editor
  islands need stable `id` values because drag positions, optional sizes, and collapse states persist
  in `localStorage`; the reset button (in the Document panel) clears those keys and reflows mounted
  islands. Islands join measured default stacks via `stackId`+`stackOrder` (left: Document 0 /
  Objects 1 / Snap 3 / Tools 4 on compact; right: View 0 / Workflow 1). The Document panel is
  pinned (`draggable={false}`); Document, Snap, and View islands are `collapsible={false}`.
- **The workflow panel is the single mode container** (right stack, under View): the
  `EditorWorkflowStatus` tab strip (Design/Fabricate/Simulate + always-visible Play/Stop) selects the
  panel body — Design → `OverlapSolveRow` (amber "Solve intersections" row, hidden at zero overlaps)
  above the inspector (`SelectionPanel`/`BendPill`/`ElasticPanel`, or a select-something
  hint), Fabricate → `BomPanel` (CSV in `titleActions`), Simulate → `SimulationPanel`+`PivotPanel`.
  There are NO separate inspector/cut-list/simulate islands anymore.
- **Compact chrome (<640, `useResponsiveLayout`)** is responsive-only, no settings: the document row is
  a single line (export/import/reset hidden <`lg`, save chip icon-only <`lg`, narrower name); the
  tool palette docks into the left measured stack (order 4) as an icons-only vertical rail
  (`Pillbox compact`); Objects mounts `defaultCollapsed`; the workflow panel moves to `bottom-right`
  (no `stackId`); Snap + View stay `hidden sm:block`. Top/inline island titles and the grip-dot drag
  handle are hidden <`lg` (the title bar itself drags). Desktop ≥`lg` is visually unchanged.
- Short visual viewports (`<720`) or very narrow phones (`<360`) replace the rail with the safe-area
  bottom primary dock. `MobileControls` owns the command/More sheets and visual-viewport-aware draw
  controls; compact panels ignore saved desktop drag/resize coordinates.
- **Right mouse button is globally hijacked** by `editor/useEditorHotkeys.ts` to end a path + suppress
  the native context menu; scene pipe/joint menus open on right-button up through
  `scene/rightClickGesture.ts` only when a rotate drag did not happen. Keyboard shortcuts (V/D/P/C/M/R/B/T/Q/E/W/G, space,
  Esc/Enter, Delete, undo/redo) are bound there — **R** = Rotate tool, **P** = Extend, **Q** = Guide
  (Shift+Q clears guides), **W** = Wireframe, **E** = elastic band; **Delete** removes a selected band
  (as well as a member/measurement).
- **`units.ts` is display-only** — never let a UI unit change what's stored. Factors are exact
  international definitions; don't round them.
- **`theme.ts` holds hardcoded three.js scene color literals** per day/night — edit these (not CSS)
  for 3D colors. shadcn tokens live in `index.css`.
- **`SelectionPanel` `teeAvailable`** gates the socket-tee option to ~perpendicular on-body joints.

_Update this file when you add/rename a panel, change the component tree, or the `__pvc` contract._
