# src/ui/editor - editor shell helpers

Focused pieces extracted from `../EditorShell.tsx`. These stay UI-only and may
import stores/actions, but must not introduce new document write paths.

## Files

| File | Responsibility | Notes |
|---|---|---|
| `EditorWorkflowStatus.tsx` | Left-side workflow/status surface for Design/Fabricate/Simulate, save state, warning count, and geometry state | Driven by `editorStore.sceneStatus`; Fabricate opens the existing BOM panel; Play remains the physics toggle |
| `PvcAutomationBridge.tsx` | Registers and merges `window.__pvc` methods | Preserve method names/signatures; this is the scripted automation contract |
| `editorStatus.ts` | Derives editor warning totals from fittings, intersections, and formed-pipe bend checks | Summary only; detailed diagnostics stay in their existing panels |
| `useEditorHotkeys.ts` | Global keyboard, right-click, and context-menu behavior | Keep in sync with `../HelpPanel.tsx` and `../Pillbox.tsx` |

## Depends on

`../../state/*`, `../../design/*`, `../../solver/*`, `../../schema`, and UI utilities.

## Read before editing

- `PvcAutomationBridge` must call `editorActions` for editing seams so scripted checks match pointer tools.
- Hotkeys are global. Preserve typing guards and the typed-length/guide entry ordering before tool shortcuts.
- Workflow chrome is additive; do not hide existing tools or make Play/BOM depend on the active tab.
- `sceneStatus` also controls scene semantic labels; keep Fabricate wiring intact for cut IDs.
