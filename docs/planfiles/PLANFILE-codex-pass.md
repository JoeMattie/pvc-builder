# PLANFILE — codex-pass recommendation implementation

Branch: `codex-pass`  
Base: local `main`  
Primary source: `docs/PVC-BUILDER-RECOMMENDATIONS.md`  
Constraint: do not push to GitHub; prepare a reviewable PR-sized branch.

## Objective

Implement a pragmatic, reviewable pass over the recommendations:

- Make the editor easier to understand by introducing workflow-level chrome, status, and persistent
  visual feedback.
- Improve fabrication trust by surfacing BOM assumptions, bend schedules, viewport cut labels, and
  source/estimate metadata.
- Improve joint and simulation inspectability.
- Split high-risk shell code into focused units without changing core behavior.
- Add interaction-level Playwright coverage for CAD workflows that scripted `__pvc` tests cannot
  protect.
- Refresh docs/context drift so future agents have a reliable map.

This branch should stay locally reviewable. Do not push.

## Coordination rules

- Keep edits scoped to the file ownership below.
- Do not revert unrelated edits or another worker's edits.
- Prefer additive seams and small extractions over broad rewrites.
- Preserve public `window.__pvc` method names unless explicitly adding new methods.
- Preserve pure boundaries: no React/three/CrashCat types in `schema`, `design`, or `solver/index`.
- If a recommendation is too large for this pass, land a useful foundation and document the follow-up
  in code/docs.

## Workstream A — Editor workflow chrome and shell split

Owner files:

- `src/ui/EditorShell.tsx`
- new `src/ui/editor/*.tsx` or `src/ui/editor/*.ts`
- `src/ui/HelpPanel.tsx`
- `src/ui/Pillbox.tsx`
- `src/ui/ViewMenu.tsx` only if needed

Tasks:

- Extract editor hotkeys into a hook.
- Extract `window.__pvc` registration into an automation bridge component.
- Add an editor top/status bar that shows document name, save state, warning count, active workflow,
  and simulation/document geometry state.
- Introduce workflow tabs or segmented control for `Design`, `Fabricate`, and `Simulate`.
- Keep existing tools available; do not remove workflows that users rely on.
- Fix the help/shortcut mismatch where `R` is documented as pivot reset but implemented as Rotate.

Acceptance:

- Existing keyboard shortcuts still work.
- The editor visibly distinguishes Design/Fabricate/Simulate.
- Save state and warnings are visible without opening panels.
- `window.__pvc` smoke seams still exist.

## Workstream B — Fabrication/BOM trust

Owner files:

- `src/schema/pipeSpec.ts`
- `src/design/bom.ts`
- `src/design/bom.test.ts`
- `src/ui/BomPanel.tsx`
- new fabrication helper modules if needed

Tasks:

- Add source/estimate metadata for take-offs and fabricated allowances.
- Use source-backed fields in `pipeSpec` where currently available, while preserving fallback
  estimates.
- Surface BOM assumption warnings in the UI and CSV.
- Show formed-pipe bend schedule details in `BomPanel`.
- Add viewport/BOM pipe label data support if it can be shared cleanly with the scene lane.

Acceptance:

- BOM rows explain estimated vs sourced values.
- Tight bend/formed pipe schedule is visible in the fabrication UI.
- Tests cover metadata and CSV output.

## Workstream C — Scene visual semantics and interaction utility

Owner files:

- `src/ui/scene/*`
- new `src/ui/scene/interactions.ts` or `src/ui/scene/Interaction*.ts`
- avoid `src/ui/EditorShell.tsx` except via agreed props/components

Tasks:

- Add persistent viewport labels for BOM cut ids when Fabricate mode is active.
- Add selected/hover labels for joint/fitting/member semantics where low risk.
- Consolidate duplicated drag lifecycle code into a shared scene interaction utility.
- Add scene warning/legend affordances where possible without disrupting rendering performance.
- Keep instanced rendering discipline; avoid per-frame React re-renders for dense designs.

Acceptance:

- Pipe labels align with BOM cut ids.
- Existing selection, draw, bend, and move interactions continue to work.
- Dense models still use instancing.

## Workstream D — Joint, object tree, and simulation inspectability

Owner files:

- `src/ui/ObjectTree.tsx`
- `src/ui/PivotPanel.tsx`
- `src/ui/SelectionPanel.tsx`
- new inspector/panel components as needed
- `src/state/editorStore.ts`
- `src/state/editorActions.ts` only for focused additive state/actions

Tasks:

- Make selected joints easier to inspect: receiver, mover, mode, manufactured/on-body, and BOM effect.
- Add object-tree rows or sections for joints, measurements, and elastics where practical.
- Expose joint limits/reset affordances more clearly.
- Add Simulate-mode controls/status for assumptions and reset-to-design/settle where practical.

Acceptance:

- Selecting a joint gives actionable information beyond the small swap button.
- Non-pipe objects are easier to discover and select.
- Simulation controls clarify when physics output is being shown.

## Workstream E — Persistence and project lifecycle polish

Owner files:

- `src/persistence/*`
- `src/state/appStore.ts`
- `src/ui/ProjectList.tsx`
- new project-list components if needed

Tasks:

- Surface rolling revisions in the UI with a restore action.
- Add rename/duplicate where practical.
- Add import on the project list.
- Add delete confirmation or undo-style safety.
- Keep autosave and migration behavior unchanged.

Acceptance:

- Users can see and restore recent revisions.
- Project management no longer relies only on open/delete.

## Workstream F — Docs/context and tests

Owner files:

- `docs/**`
- `src/*/CONTEXT.md`
- `e2e/**`
- tests touching owned implementation files

Tasks:

- Refresh schema/version/context drift.
- Add a small Playwright interaction suite using real pointer/keyboard flows.
- Add screenshot or DOM assertions for the new workflow chrome where stable.
- Update user-facing help for new workflow/status behavior.

Acceptance:

- Context files no longer claim schema v9 where v10 is current.
- At least one real pointer/keyboard interaction test covers draw/typed length or right-click join.

## Main-agent integration responsibilities

The main agent owns:

- Branch coordination.
- This planfile.
- Final conflict resolution.
- Running verification.
- PR summary.

The main agent may also implement cross-cutting glue after worker patches land.

## Verification target

Before final response:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run e2e` when build/preview requirements are satisfied

If any command fails, fix the failure or report the exact blocker.

