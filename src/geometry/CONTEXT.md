# src/geometry — pure 3D math (copied verbatim from riglab)

Dependency-free vector/quaternion helpers and shared pipe-polyline geometry. **No three.js
here** — the r3f UI converts these plain records at the boundary. Intentionally three.js-free so
the geometry layer stays pure and fast to test. Barrel: `index.ts` re-exports both.

## Files

| File | Responsibility | Key exports |
|---|---|---|
| `math3.ts` (87) | Minimal Vec3/Quaternion ops | `add`, `sub`, `scale`, `dot`, `cross`, `length`, `normalize`, `rotate`, `mulQ`, `quatFromBasis`, `IDENTITY_Q` |
| `pipe.ts` (113) | Shared pipe-polyline geometry (used by BOTH rendering and BOM — one definition of developed length) | `polylineLengthM`, `deflectionAngleRad`, `developedLengthM(points, filletRadiiM)`, `bendDihedralsRad` |

## Depends on
`../schema` (types `Vec3`, `Quaternion` only).

## Read before editing
- **Copied verbatim from riglab** — prefer keeping them in sync with `/home/joe/dev/riglab`.
- **`mulQ` uses the three.js "apply b first" convention.** `normalize` guards zero vectors (< 1e-12).
- **`developedLengthM` subtracts `Σ r·(2·tan(φ/2) − φ)` per filleted vertex**, clamped ≥ 0.
- **Fillet/dihedral arrays align to interior vertices** (`length = points.length − 2`);
  `filletRadiiM[i]` maps to `controlPoints[i]`. Off-by-one here is easy to get wrong.

_Update this file if the math API changes or riglab sync drifts._
