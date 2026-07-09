# CODE-MAP — where the code lives

Index of the per-directory `CONTEXT.md` orientation files. **Read the relevant `CONTEXT.md`
before working in a directory** — each is a reference card of that directory's files, key exports,
cross-directory dependencies, and read-before-editing gotchas. The authoritative product spec is
`docs/planfiles/PLANFILE-pvc-builder.md`; decisions log is `DECISIONS.md`; conventions are `CLAUDE.md`.
The end-user manual (features + interactions, with screenshots) is `docs/USER-GUIDE.md`; the same
shortcut reference is surfaced in-app via `src/ui/HelpPanel.tsx`.

## The architecture in one line
Pure cores behind narrow interfaces: **`schema`** (Zod source of truth) → **`geometry`** (pure math)
→ **`design`** (pure doc ops / fittings / BOM) and **`solver`** (kinematics behind `solve()`) → wired
by **`state`** (stores + the one action layer) → rendered by **`ui`** / **`ui/scene`** (impure R3F).
Durable state in **`persistence`**; samples in **`examples`**.

## Directory map (read in dependency order)

| Directory | What's there | Context file |
|---|---|---|
| `src/schema/` | Zod `Design` schema, migrations (v10), SCH 40 `PipeSpec` table | [CONTEXT](../src/schema/CONTEXT.md) |
| `src/geometry/` | Pure Vec3/Quaternion math + pipe-polyline geometry (from riglab) | [CONTEXT](../src/geometry/CONTEXT.md) |
| `src/design/` | **Tested core** — docOps, fittings, bom, formed, snapping, dragMath, intersections, marquee, extend, guides | [CONTEXT](../src/design/CONTEXT.md) |
| `src/solver/` | `solve()` boundary, closed-form kinematics, CrashCat physics subsystem | [CONTEXT](../src/solver/CONTEXT.md) |
| `src/state/` | zustand stores (appStore/editorStore) + the ONE action layer + `__pvc` seams | [CONTEXT](../src/state/CONTEXT.md) |
| `src/persistence/` | Dexie project store, autosave, JSON export/import, prefs | [CONTEXT](../src/persistence/CONTEXT.md) |
| `src/examples/` | Bundled sample designs (incl. the five cumulative Project Raptor mannequin templates) | [CONTEXT](../src/examples/CONTEXT.md) |
| `src/ui/` | React chrome — panels, toolbars, router, `window.__pvc`, units, theme | [CONTEXT](../src/ui/CONTEXT.md) |
| `src/ui/scene/` | three.js / R3F rendering layer + pure mesh-builder CAD-swap seams | [CONTEXT](../src/ui/scene/CONTEXT.md) |
| `src/dev/` | **Dev-only** browser half of the live bridge (drives `window.__pvc` for an external process) | [CONTEXT](../src/dev/CONTEXT.md) |

Not documented with a CONTEXT file (small/self-evident): `src/main.tsx` (entry point), `src/index.css`
(Tailwind v4 tokens), root config (`package.json`, `vite.config.ts`, `tsconfig.json`, `biome.json`,
`playwright.config.ts`), `e2e/*.spec.ts` (Playwright smoke + interaction checks against the built app).
The **dev-only live bridge** to a running session also lives outside `src/`: `vite/pvcBridgePlugin.ts`
(the `apply:'serve'` relay hub, `/__pvc/*` HTTP+SSE, unit-tested) and `tools/pvc-mcp/` (the MCP
front-end + `.mcp.json`) — see `src/dev/CONTEXT.md` and `tools/pvc-mcp/README.md`.

## Fast facts
- **Everything stored is SI** (metres/radians); imperial is display-only (`src/ui/units.ts`).
- **`schemaVersion` is 10**; every schema change bumps it + adds a migration (`src/schema/`).
- **Pure boundaries that must stay pure**: `resolveFittings`, `bom`, `solve()` — no three/UI/engine types.
- **`window.__pvc`** (registered in `src/ui/editor/PvcAutomationBridge.tsx`) is the scripted
  automation contract.
- **Live dev bridge** (dev-only): an external process can query state + drive every `__pvc` seam
  over `/__pvc/*` (`vite/pvcBridgePlugin.ts`) via the MCP server in `tools/pvc-mcp/`. Never in prod.
- **Definition of done**: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all green.

## Keeping this map current
When you add/rename a source directory or significantly change a directory's role, update the table
above AND create/refresh that directory's `CONTEXT.md`. See `CLAUDE.md` → "Working with context files".
