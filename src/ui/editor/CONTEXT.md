# src/ui/editor - editor shell helpers

Focused pieces extracted from `../EditorShell.tsx`. These stay UI-only and may
import stores/actions, but must not introduce new document write paths.

## Files

| File | Responsibility | Notes |
|---|---|---|
| `EditorWorkflowStatus.tsx` | Exports `EditorWorkflowStatus` (the workflow panel's TAB STRIP — Design/Fabricate/Simulate tabs + an always-visible Play/Stop button) AND `EditorStatusChips` (autosave + warning-count chips, rendered in the Document panel; save-chip label is icon-only below `lg`) | Driven by `editorStore.sceneStatus`; each tab's content is the workflow panel body in `EditorShell` (Design → inspector, Fabricate → cut list, Simulate → sim controls) |
| `SimulationPanel.tsx` | Simulate tab body (bare — no card chrome; renders inside the workflow panel) | damping, mannequin, debug, reset + state chips; NO Play button (the tab strip owns Play/Stop) and NO lengths lock — that moved to the toolbar as "Drag lock" (`../Pillbox.tsx`, toggles `design.lengthsLocked`) |
| `PvcAutomationBridge.tsx` | Registers and merges `window.__pvc` methods | Preserve method names/signatures; this is the scripted automation contract |
| `editorStatus.ts` | Derives editor warning totals from fittings, intersections, and formed-pipe bend checks | Summary only; detailed diagnostics stay in their existing panels |
| `useEditorHotkeys.ts` | Global keyboard, right-click, and context-menu behavior | Keep in sync with `../HelpPanel.tsx` and `../Pillbox.tsx` |

## Depends on

`../../state/*`, `../../design/*`, `../../solver/*`, `../../schema`, and UI utilities.

## Read before editing

- `PvcAutomationBridge` must call `editorActions` for editing seams so scripted checks match pointer tools.
- Hotkeys are global. Preserve typing guards and the typed-length/guide entry ordering before tool shortcuts.
- The workflow panel is the ONE mode container (right stack under View): tabs select its body —
  inspector / cut list / sim controls. Core tools remain keyboard-accessible in every tab.
- `sceneStatus` also controls scene semantic labels; keep Fabricate wiring intact for cut IDs.
