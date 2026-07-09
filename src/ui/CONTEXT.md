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
| `EditorShell.tsx` | Editor screen — hosts viewport + all floating chrome, restores/persists doc viewport state | **narrow field subscriptions on purpose**; masks camera restore (and the renderer-effects toggle) with a short blurred overlay; Simulate-specific controls live in `editor/SimulationPanel.tsx`; Document panel (pinned top-left, `draggable`/`collapsible` false) holds back/name/export/import + workspace-reset + `EditorStatusChips` |
| `chrome/` | Shared editor chrome wrappers | `FloatingIsland` provides top/inline title chrome, collapse, title-bar drag/resize, saved positions/sizes/collapse (sizes only apply when `resizable`), magnetic edge snapping (`snapFloatingPos` — panels MAY overlap; no overlap avoidance), workspace reset, viewport clamping, `draggable={false}` pinning (no handle, no saved pos), and measured default stacks (`stackId`+`stackOrder` place non-user-moved panels under lower-order peers; mount + reset run a double rAF "settle" pass). Pure helpers tested in `FloatingIsland.test.ts` |
| `editor/` | Extracted editor-shell helpers | workflow/status chrome, simulation panel, global hotkeys, and `PvcAutomationBridge` for `window.__pvc`; read `editor/CONTEXT.md` before editing |
| `BomPanel.tsx` | Cut-list / BOM panel + CSV download | lengths via `formatLength(m, units)`; cut rows dominate — assumptions/sources are a collapsed-by-default `<details>` disclosure at the bottom |
| `SelectionPanel.tsx` (221) | Selected-member inspector — editable length, bend warnings, joint-mode controls | controlled draft string synced from geometry |
| `PivotPanel.tsx` (101) | Locked-mode pivot controls — mobility readout + per-wrapped-joint angle slider | free joints get no slider (posed by dragging) |
| `ElasticPanel.tsx` (—) | Selected elastic-band controls — tension (stiffness) slider + current/rest span + delete | shown when `selectedElasticId` set; drives `setElasticTension` |
| `Pillbox.tsx` | Tool + size pillbox + Group/Ungroup + "Drag lock" (`design.lengthsLocked`) toggle | horizontal/vertical layouts (`editorStore.toolPaletteLayout` + a toggle button); horizontal wraps, labels ≥lg, hotkey kbds ≥2xl; its island is non-resizable/content-sized so every button stays visible; sizes hardcoded `['1/2"','3/4"']` |
| `ObjectTree.tsx` | Left-side tree of pipes + groups — click/Ctrl-click selects, grouped click auto-enters the group, per-group colour swatch/picker | subscribes to a STRUCTURAL doc signature (not positions) so a drag doesn't churn the list |
| `HelpPanel.tsx` (—) | Self-contained modal help / keyboard-shortcut reference (no network) | opened by the editor `?` button (EditorShell top-right) + the ProjectList "Guide" button; keep the shortcut list in sync with `editor/useEditorHotkeys.ts` |
| `ConfirmDialog.tsx` | Small Radix AlertDialog confirmation primitive | used for destructive project delete flow; prefer this over native `window.confirm` |
| `JoinMenu.tsx` (120) | Right-click join menu (Anchor/Wrapped/Free) — opens only at a shared junction / joint hardware | options gated by `joinContext` geometry |
| `SizeMenu.tsx` (—) | Right-click size switcher (1/2"↔3/4") for a pipe or the whole multi-selection | opens on a pipe body / lone end; drives `setMembersSize` |
| `SnapPill.tsx` (133) | Bottom-left snap settings (grid + toggles) | Radix portal-backed menu so it is not clipped by floating chrome; grid options are unit-dependent |
| `ProjectList.tsx` (103) | Landing screen — create/open/delete + grouped examples + a "Guide" (help) button | examples are display-grouped Basic/Raptor/T-Rex; changelog shows two newest versions until "Show older versions" is opened |
| `ViewMenu.tsx` | Camera view preset dropdown | Radix portal-backed so it is not clipped by floating chrome overflow |
| `units.ts` (168) | **Display-only** length/mass conversion + `formatLengthDisplay`/`parseLength` (mm/cm/in/in-frac, schema v6) | ⚠ everything stored is SI; `parseLength` reads `10mm`/`1/2"`/`10ft`… |
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
  Workflow 1 / Objects 2; right: View 0 / Simulate 1 / Cut list 2). The Document panel is pinned
  (`draggable={false}`); Document, Workflow, Snap, and View islands are `collapsible={false}`.
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
