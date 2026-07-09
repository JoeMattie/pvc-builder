# src/ui — React chrome (the impure outer layer)

Panels, toolbars, and the app router. Two stores wired throughout: `../state/appStore` (persisted
document) and `../state/editorStore` (transient UI); most panels call thin creators in
`../state/editorActions`. Display units convert at the boundary via `./units` — **internal is SI**.
The 3D rendering layer is the separate `scene/` subdirectory (see `scene/CONTEXT.md`).

## Component hierarchy
`App` (root, from `main.tsx`) → `ProjectList` when no `current`, else `EditorShell`. `EditorShell`
renders `scene/Viewport` as the base layer, then floats all chrome as absolutely-positioned
siblings.

## Files

| File | Responsibility | Notes |
|---|---|---|
| `App.tsx` (15) | Top-level router (projects vs editor) | runs `refreshProjects()` on mount |
| `EditorShell.tsx` (458) | Editor screen — hosts viewport + all chrome, global keyboard/pointer, **defines `window.__pvc`** (lines ~196-298) | huge import surface; **narrow field subscriptions on purpose**; toolbar has a person-icon **mannequin** toggle (`setMannequin`) + a Play-mode **Damping** slider (0.2–5×, `setJointDamping`) — both write doc flags (schema v9) |
| `BomPanel.tsx` (129) | Cut-list / BOM panel + CSV download | lengths via `formatLength(m, units)` |
| `SelectionPanel.tsx` (221) | Selected-member inspector — editable length, bend warnings, joint-mode controls | controlled draft string synced from geometry |
| `PivotPanel.tsx` (101) | Locked-mode pivot controls — mobility readout + per-wrapped-joint angle slider | free joints get no slider (posed by dragging) |
| `ElasticPanel.tsx` (—) | Selected elastic-band controls — tension (stiffness) slider + current/rest span + delete | shown when `selectedElasticId` set; drives `setElasticTension` |
| `Pillbox.tsx` (104) | Bottom-center tool + size pillbox | sizes hardcoded `['1/2"','3/4"']`; tools incl. Extend (P), Rotate (R), Guide (Q) |
| `ObjectTree.tsx` | Left-side tree of pipes + groups — click/Ctrl-click selects, grouped click auto-enters the group, per-group colour swatch/picker, Group/Ungroup buttons | subscribes to a STRUCTURAL doc signature (not positions) so a drag doesn't churn the list |
| `HelpPanel.tsx` (—) | Self-contained modal help / keyboard-shortcut reference (no network) | opened by the editor `?` button (EditorShell top-right) + the ProjectList "Guide" button; keep the shortcut list in sync with EditorShell's keydown handler |
| `JoinMenu.tsx` (120) | Right-click join menu (Anchor/Wrapped/Free) — opens only at a shared junction / joint hardware | options gated by `joinContext` geometry |
| `SizeMenu.tsx` (—) | Right-click size switcher (1/2"↔3/4") for a pipe or the whole multi-selection | opens on a pipe body / lone end; drives `setMembersSize` |
| `SnapPill.tsx` (133) | Bottom-left snap settings (grid + toggles) | grid options are unit-dependent |
| `ProjectList.tsx` (103) | Landing screen — create/open/delete + examples + a "Guide" (help) button | header comment may be stale |
| `units.ts` (168) | **Display-only** length/mass conversion + `formatLengthDisplay`/`parseLength` (mm/cm/in/in-frac, schema v6) | ⚠ everything stored is SI; `parseLength` reads `10mm`/`1/2"`/`10ft`… |
| `UnitsPill.tsx` (—) | Bottom-right display-units picker → writes `design.lengthDisplay` | display-only; default decimal inches |
| `theme.ts` (40) | Day/night — toggles `.dark` + supplies **literal three.js scene colors** | three.js can't read CSS vars; edit scene colors HERE |
| `lib/download.ts` (—) | Client-side file download (no network) | `downloadFile(name, content, mime)` |
| `lib/utils.ts` (—) | shadcn `cn()` className helper | — |

## Depends on
`../state/*`, `../design/*` (bom, docOps, fittings, formed, intersections), `../solver`,
`../solver/physics`, `../persistence/exportImport`, `../geometry/math3`, `../schema`, `./scene/*`.

## Read before editing
- **`window.__pvc` is a public contract** (defined in `EditorShell.tsx`) — E2E and scripted checks
  depend on the exact method names/signatures. Treat as API. See `../state/CONTEXT.md` for the list.
- **`EditorShell` subscribes to individual scalars, not the whole doc** (comment lines ~89-90) so
  per-frame drag mutations don't re-render the chrome. Preserve when adding state.
- **Right mouse button is globally hijacked** to end a path + suppress the context menu (right-drag
  still orbits). Keyboard shortcuts (V/D/P/C/M/R/B/T/Q/E/W/G, space, Esc/Enter, Delete, undo/redo) bound
  here — **R** = Rotate tool, **P** = Extend, **Q** = Guide (Shift+Q clears guides), **W** = Wireframe,
  **E** = elastic band; **Delete** removes a selected band (as well as a member/measurement).
- **`units.ts` is display-only** — never let a UI unit change what's stored. Factors are exact
  international definitions; don't round them.
- **`theme.ts` holds hardcoded three.js scene color literals** per day/night — edit these (not CSS)
  for 3D colors. shadcn tokens live in `index.css`.
- **`SelectionPanel` `teeAvailable`** gates the socket-tee option to ~perpendicular on-body joints.

_Update this file when you add/rename a panel, change the component tree, or the `__pvc` contract._
