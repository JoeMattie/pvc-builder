# src/ui/editor - editor shell helpers

Focused pieces extracted from `../EditorShell.tsx`. These stay UI-only and may
import stores/actions, but must not introduce new document write paths.

## Files

| File | Responsibility | Notes |
|---|---|---|
| `EditorWorkflowStatus.tsx` | Exports `EditorWorkflowStatus` (inline Design/Fabricate/Simulate row in the workflow island) AND `EditorStatusChips` (autosave + warning-count chips, rendered in the Document panel; save-chip label is icon-only below `lg`) | Driven by `editorStore.sceneStatus`; Fabricate opens the existing cut-list panel |
| `SimulationPanel.tsx` | Dedicated Simulate workspace controls | Play/Stop, damping, mannequin, debug, and reset; NO "Simulate" heading (the island title bar has it) and NO lengths lock — that moved to the toolbar as "Drag lock" (`../Pillbox.tsx`, toggles `design.lengthsLocked`) |
| `PvcAutomationBridge.tsx` | Registers and merges `window.__pvc` methods | Preserve method names/signatures; this is the scripted automation contract |
| `editorStatus.ts` | Derives editor warning totals from fittings, intersections, and formed-pipe bend checks | Summary only; detailed diagnostics stay in their existing panels |
| `useEditorHotkeys.ts` | Global keyboard, right-click, and context-menu behavior | Keep in sync with `../HelpPanel.tsx` and `../Pillbox.tsx` |

## Depends on

`../../state/*`, `../../design/*`, `../../solver/*`, `../../schema`, and UI utilities.

## Read before editing

- `PvcAutomationBridge` must call `editorActions` for editing seams so scripted checks match pointer tools.
- Hotkeys are global. Preserve typing guards and the typed-length/guide entry ordering before tool shortcuts.
- Workflow chrome is additive; Fabricate may open BOM and Simulate shows simulation controls, but core tools
  remain keyboard-accessible.
- `sceneStatus` also controls scene semantic labels; keep Fabricate wiring intact for cut IDs.
