# AGENT-COORDINATION — parallel work board

Central board for coordinating **parallel** work across multiple agents / sessions so simultaneous
tasks reconcile with minimal merge conflicts. If you are the only agent working, you can skip the
worktree step — but still glance at the active-claims table so you don't collide with a background agent.

## How to work in parallel (the protocol)

1. **Claim first.** Before editing, add a row to the *Active claims* table below (branch, agent,
   the files/directories you expect to change, and status). Commit that claim change on `main`
   (or note it) so other agents see it. Check the table for overlaps before you start — if someone
   already owns files you need, coordinate or pick a different slice.
2. **Work on a git worktree, not the main checkout.** Each parallel task gets its own worktree +
   branch so working trees never collide:
   ```
   git worktree add ../pvc-builder-<task-slug> -b feat/<task-slug>
   ```
   (The Agent tool's `isolation: "worktree"` does this automatically — prefer it for parallel agents.)
   Do the work there, run the full green-bar (`typecheck` + `lint` + `test` + `build`), commit.
3. **Prefer edits that don't touch shared choke points** (see below). If your task must, say so in
   your claim and keep the change surgical.
4. **Release.** When merged, delete your claim row and run `git worktree remove ../pvc-builder-<task-slug>`.

## Shared choke points (high merge-conflict risk — coordinate before touching)

- **`src/schema/design.ts` + `src/schema/migrations.ts`** — any schema change bumps `SCHEMA_VERSION`
  and adds a migration. Two agents bumping the version at once WILL conflict. Serialize schema work:
  only one active claim may touch schema at a time.
- **`src/ui/EditorShell.tsx` + `src/ui/editor/*`** — shell composition, workflow chrome, global
  keyboard/pointer bindings, and the `PvcAutomationBridge` `window.__pvc` contract are central,
  frequently edited surfaces. Adding a `__pvc` seam here is a common collision.
- **`src/state/editorActions.ts`** — the single action layer everything routes through.
- **`src/ui/scene/Scene.tsx`** — composes all layers; adding/removing a layer touches it.
- **`src/design/docOps.ts`** — the docOps hub imported by bom/fittings/formed/intersections.
- **`DECISIONS.md`** (append newest-first at the top), **`CLAUDE.md`**, **`docs/CODE-MAP.md`**,
  **`todo.txt`**, and this file — text docs that many tasks append to; keep edits small and localized.

Directory-local work (one file in `src/design/`, one panel in `src/ui/`, one scene layer) rarely
conflicts — the boundaries in `docs/CODE-MAP.md` are designed for exactly this parallelism.

## Active claims

_Add a row when you start; delete it when merged. Keep it current — a stale claim blocks others._

| Branch | Agent / session | Files or dirs being changed | Touches choke point? | Status | Started |
|---|---|---|---|---|---|
| _(none active)_ | — | — | — | — | — |

## Recently merged (rolling, trim freely)

| Branch | What landed | Merged |
|---|---|---|
| main (direct) | Dev-only live bridge: `vite/pvcBridgePlugin.ts` + `src/dev/bridgeClient.ts` + `tools/pvc-mcp/` + `.mcp.json` (query/drive a running session from Claude Code) | 2026-07-09 (uncommitted) |
