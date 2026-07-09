# src/dev — dev-only bridge (browser half)

The browser side of the **live dev bridge** that lets an external process (Claude Code / curl)
query the running session and drive it through `window.__pvc`. Pairs with `vite/pvcBridgePlugin.ts`
(the relay hub inside the dev server) and `tools/pvc-mcp/` (the MCP front-end). **Dev-only**:
loaded via a dynamic `import.meta.env.DEV` guard in `../main.tsx`, so it is tree-shaken out of
production builds — production stays static/no-network (CLAUDE.md invariant).

## Files

| File | Responsibility | Key behaviour |
|---|---|---|
| `bridgeClient.ts` (~190) | Executes RPC + streams state to the bridge | `EventSource('/__pvc/commands')` → runs `window.__pvc[method](...args)` (pointer/script parity) → POSTs result to `/__pvc/result`; synthetic `__state` command returns the FULL dump; store subscriptions POST throttled `doc`/`editor` events to `/__pvc/event` |

## Depends on
`../state/*` (`appStore` incl. `.temporal`, `editorStore`, `themeStore`, `cameraStore`,
`editorActions.pivotAnglesOf`/`jointOrientationsOf`), `../design/{fittings,bom}`, `../solver`.
Reads assemble from the stores directly; **all actions still route through `window.__pvc`** so a
scripted call drives exactly what the pointer drives.

## The `__state` dump
The one-shot answer to "every bit of state" (the piecemeal seams omit most of it):
`app` (`saveState`, `projectCount`, whole `current` Design) · `history` (undo/redo depth from
`useAppStore.temporal`) · `editor` (ALL non-function `editorStore` fields, not just the 8 in
`getEditor()`) · `theme.night` · `camera` (`getCameraPose()` + `poseVersion`) · `derived`
(`resolveFittings`, `solve`, `bom`, each guarded so one throw doesn't sink the dump).

## Gotchas
- Guarded against double-install via `window.__pvcBridge` (HMR / re-import safe).
- Most-recent browser connection wins on the command channel; two tabs will fight — use one.
- If no design is open, `window.__pvc` may be absent → RPC returns a clear "is a design open?"
  error rather than throwing opaquely.
