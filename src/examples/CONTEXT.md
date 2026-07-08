# src/examples — bundled sample designs

Sample designs offered from the project list (planfile §7). **Rule: generic subjects only — no
creature-specific identifiers in generator code or geometry ids.**

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `generators.ts` (78) | Hand-built designs via a `build(name, nodes, edges, size)` helper | `cubeFrame()` (1m cube, 8 nodes/12 members, corner conflicts), `articulatedArm()` (3 links + 2 wrapped joints) |
| `index.ts` (34) | The `EXAMPLES` registry | `Example` interface, `EXAMPLES` (3: `articulated-arm`, `cube-frame`, `trex-wireframe`) — each `load()` returns a `Design` |
| `trex-wireframe.json` | Baked 262-node / 780-pipe wireframe, `schemaVersion:1`, run through `migrateToLatest` on load | — |

## Depends on
`../schema` (`createEmptyDesign`, `migrateToLatest`).

## Read before editing
- **"No creature identifiers" rule**: `generators.ts` and the JSON's structural ids (`n0`, `m0`)
  are clean, BUT the trex example's human-facing `name`/`description` say "T-rex". If tightening
  the rule, that display metadata is the only place it appears — generator source stays generic.
- **`trex-wireframe.json` is `schemaVersion:1`** on purpose — it exercises the full migration chain
  on every load. Keep it valid against v1, or the migration test contract.
- New examples must `load()` a Design that passes `designSchema` (loaded content is migrated).

_Update this file when you add an example or touch the no-creature-identifiers boundary._
