# src/ui/editor - editor shell helpers

Focused pieces extracted from `../EditorShell.tsx`. These stay UI-only and may
import stores/actions, but must not introduce new document write paths.

## Files

| File | Responsibility | Notes |
|---|---|---|
| `EditorWorkflowStatus.tsx` | Exports `EditorWorkflowStatus` (the workflow panel's TAB STRIP — Design/Fabricate/Simulate tabs + an always-visible Play/Stop button), `EditorStatusChips` (autosave + warning-count chips, rendered in the Document panel; save-chip label is icon-only below `lg`) AND `OverlapSolveRow` (self-subscribing amber row at the top of the Design tab while pipes overlap red: "N overlapping pipes" + a Solve-intersections button calling `editorActions.solveIntersections`; renders null at zero overlaps) | Driven by `editorStore.sceneStatus`; each tab's content is the workflow panel body in `EditorShell` (Design → inspector, Fabricate → cut list, Simulate → sim controls) |
| `SimulationPanel.tsx` | Simulate tab body (bare — no card chrome; renders inside the workflow panel) | damping, mannequin, debug, reset + state chips; NO Play button (the tab strip owns Play/Stop) and NO lengths lock — that moved to the toolbar as "Drag lock" (`../Pillbox.tsx`, toggles `design.lengthsLocked`) |
| `PvcAutomationBridge.tsx` | Registers and merges `window.__pvc` methods | Preserve method names/signatures; this is the scripted automation contract |
| `editorStatus.ts` | Derives editor warning totals from fittings, intersections, and formed-pipe bend checks | Summary only; detailed diagnostics stay in their existing panels |
| `useEditorHotkeys.ts` | Global keyboard, right-click, and context-menu behavior | Keep in sync with `../HelpPanel.tsx` and `../Pillbox.tsx`. Right button ends an in-progress draw/formed path on RELEASE, gated by `../scene/rightClickGesture.ts` (`wasRightDrag`) — an orbit right-drag must never abort the path |
| `numericEntryKeys.ts` | THE shared allow-list for NUMERIC scene entries (draw length pill, guide offset pill, rotate typed-angle input) | `classifyNumericEntryKey`: digits `.` `-` `/` `'` `"` and **m/M only** insert; nav/edit keys stay in the entry; ANY other letter + Space = `'hotkey'` (cancel entry/op, then the global hotkey fires); Ctrl/Cmd/Alt combos pass through. `NUMERIC_ENTRY_ATTR`/`_DOM_PROPS` mark a real `<input>` (rotate angle) so the hotkey handler's typing guard doesn't swallow its cancelled-hotkey keys |
| `MobileControls.tsx` | Compact command/More sheets, short-screen primary dock, Edit/Orbit switch, visible path completion and exact-length controls | Radix Dialog sheets; edits still call stores/actions |
| `useResponsiveLayout.ts` | Responsive/visual viewport contract | `{ compactWidth, veryNarrow, shortViewport, visualViewport }`; listens to `visualViewport` resize/scroll |

## Depends on

`../../state/*`, `../../design/*`, `../../solver/*`, `../../schema`, and UI utilities.

## Read before editing

- `PvcAutomationBridge` must call `editorActions` for editing seams so scripted checks match pointer tools.
- Hotkeys are global. Preserve typing guards and the typed-length/guide entry ordering before tool
  shortcuts. Numeric scene entries obey `numericEntryKeys.ts`: the only letter they keep is `m`
  (units are typed as `m`/`mm`/`'`/`"`, never `in`/`ft`/`cm`); any other letter or Space cancels the
  entry AND its operation, then falls through to the tool hotkeys as if no entry were active. The
  typing guard ignores `<input>`s ONLY when they carry `data-numeric-entry` — normal text fields
  (rename, search) stay fully protected.
- The workflow panel is the ONE mode container (right stack under View): tabs select its body —
  inspector / cut list / sim controls. Core tools remain keyboard-accessible in every tab.
- `sceneStatus` also controls scene semantic labels; keep Fabricate wiring intact for cut IDs.
