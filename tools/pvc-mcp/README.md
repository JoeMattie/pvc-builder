# pvc-mcp — live dev bridge for Claude Code

An MCP server that lets Claude Code (or any MCP client) query and drive a **running** PVC Builder
browser session during local development — inspect the current model, see what's selected, invoke
any `window.__pvc` seam, and tail live state changes.

## How it fits together

```
Claude Code ──stdio(MCP)──► server.mjs ──HTTP──► Vite dev plugin ──SSE──► browser bridge client ──► window.__pvc
                            (this file)   fetch   (in `npm run dev`)                                  + stores
```

- **`vite/pvcBridgePlugin.ts`** — the relay hub, runs inside `npm run dev` (dev-only,
  `apply: 'serve'`). Routes live under `/__pvc/*`.
- **`src/dev/bridgeClient.ts`** — the browser half; executes commands against `window.__pvc` and
  streams store-change events. Loaded only under `import.meta.env.DEV`.
- **`server.mjs`** — this MCP server; proxies tool calls to the hub over HTTP.

Nothing here ships to production: the plugin never runs during `vite build`, and the browser
client is tree-shaken out.

## Setup

1. It is already registered in the repo-root **`.mcp.json`** as the `pvc` server, so Claude Code
   loads it automatically (approve it when prompted). It sources nvm, then runs
   `node tools/pvc-mcp/server.mjs`.
2. Start the app and open a design: `npm run dev`, then load/create a project in the browser so
   `window.__pvc` is live.
3. Use the tools from Claude Code.

The dev server URL defaults to `http://localhost:5173`; override with the `PVC_BRIDGE_URL` env var
if you run Vite on another port.

## Tools

| Tool | What it does |
|---|---|
| `pvc_get_state` | Full session snapshot — document + all editor state + undo depth + camera + derived fittings/solve/BOM. **Start here.** |
| `pvc_get_doc` / `pvc_get_editor` | The Design document / the existing `getEditor` subset. |
| `pvc_get_fittings` / `pvc_get_solve` / `pvc_get_bom` | Derived: fittings+conflicts / kinematic solve / cut-list. |
| `pvc_get_members` / `pvc_get_joints` | Members (with lengths) / joint records. |
| `pvc_set_tool` / `pvc_set_lengths_locked` / `pvc_set_pivot_angle` | Drive tool / global lock / a pivot angle. |
| `pvc_select` / `pvc_delete` | Set selection (members or a joint) / delete members. |
| `pvc_export_json` / `pvc_import_json` | Round-trip the design as JSON. |
| `pvc_call` | **Escape hatch** — call any `window.__pvc` seam by name with args. |
| `pvc_recent_events` | Drain buffered live events since a sequence number. |
| `pvc_health` | Is a browser connected? watcher/pending counts, last event seq. |

## Live tailing

For real-time watching (e.g. while reproducing a bug), tail the event SSE directly instead of
polling `pvc_recent_events`:

```
curl -N http://localhost:5173/__pvc/stream
```

Each `doc` / `editor` change emits one event.

## Raw HTTP (no MCP)

The hub is plain HTTP, so you can also drive it with curl:

```
curl -s localhost:5173/__pvc/call -H 'content-type: application/json' -d '{"method":"getDoc"}'
curl -s localhost:5173/__pvc/call -H 'content-type: application/json' -d '{"method":"__state"}'
curl -s localhost:5173/__pvc/call -H 'content-type: application/json' -d '{"method":"setTool","args":["draw"]}'
```
