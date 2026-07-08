// Procedural geometry for a heat-wrapped tee (planfile §4), the CAD-swap seam
// mirroring fittingMesh.ts. Pure + testable — no three/UI types.
//
// Rendered as a molded SLIP SADDLE fitting drawn around the intersecting pipe:
// a collar sleeve that slips over the through pipe + a branch socket boss the
// branch pipe slides into, joined by a blend body so the branch flows smoothly
// into the fitting. Same composed-primitive style as the socket fittings.
import { add, cross, dot, length, normalize, scale, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';

export interface WrapCyl {
  kind: 'cylinder';
  a: Vec3;
  b: Vec3;
  radiusM: number;
}
export interface WrapSphere {
  kind: 'sphere';
  center: Vec3;
  radiusM: number;
}
export type WrapPrim = WrapCyl | WrapSphere;

/** A screw head on a rigid (set-screwed) fitting, drawn as a little disc. */
export interface WrapScrew {
  center: Vec3;
  normal: Vec3;
  radiusM: number;
}

export interface WrapMesh {
  prims: WrapPrim[];
  /** empty for a pivot (free) wrap */
  screws: WrapScrew[];
  rigid: boolean;
}

export interface WrapInput {
  /** the intact through pipe's endpoints + OD */
  through: { a: Vec3; b: Vec3; odM: number };
  /** the branch's end, on the through pipe's centre-line */
  wrapPoint: Vec3;
  /** unit direction from `wrapPoint` outward along the branch */
  branchDir: Vec3;
  branchODM: number;
  rigid: boolean;
}

/** Sleeve/socket outer radius = pipe OD/2 × this (the fitting slips over/around
 * the pipe), matching the socket-fitting hub factor. */
const HUB_WALL = 1.3;
/** bell-lip flare at a socket mouth. */
const BELL = 1.14;

/** Any unit vector perpendicular to `u`. */
function anyPerp(u: Vec3): Vec3 {
  const t = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(u, t));
}

export function buildWrapMesh(inp: WrapInput): WrapMesh | null {
  const du = sub(inp.through.b, inp.through.a);
  if (length(du) < 1e-6) return null; // degenerate through pipe
  const u = normalize(du);
  const rt = inp.through.odM / 2;
  const rb = inp.branchODM / 2;

  // radial toward the branch (perpendicular component of the branch direction)
  let er = sub(inp.branchDir, scale(u, dot(inp.branchDir, u)));
  er = length(er) < 1e-6 ? anyPerp(u) : normalize(er);

  const rCollar = rt * HUB_WALL; // sleeve slips over the run
  const lCollar = Math.max(inp.branchODM * 2.2, inp.through.odM * 1.6);
  const rSocket = rb * HUB_WALL; // the branch pipe slips into this socket
  const lSocket = inp.branchODM * 1.7;
  const wp = inp.wrapPoint;

  const prims: WrapPrim[] = [
    // collar sleeve drawn around the through pipe
    {
      kind: 'cylinder',
      a: add(wp, scale(u, -lCollar / 2)),
      b: add(wp, scale(u, lCollar / 2)),
      radiusM: rCollar,
    },
    // bell lips at the collar ends (molded look)
    {
      kind: 'cylinder',
      a: add(wp, scale(u, -lCollar / 2)),
      b: add(wp, scale(u, -lCollar * 0.42)),
      radiusM: rCollar * BELL,
    },
    {
      kind: 'cylinder',
      a: add(wp, scale(u, lCollar / 2)),
      b: add(wp, scale(u, lCollar * 0.42)),
      radiusM: rCollar * BELL,
    },
    // branch socket boss (starts inside the collar, rises along the branch)
    { kind: 'cylinder', a: wp, b: add(wp, scale(inp.branchDir, lSocket)), radiusM: rSocket },
    // bell lip at the socket mouth
    {
      kind: 'cylinder',
      a: add(wp, scale(inp.branchDir, lSocket * 0.82)),
      b: add(wp, scale(inp.branchDir, lSocket * 1.02)),
      radiusM: rSocket * BELL,
    },
    // blend body at the crotch so the branch flows smoothly into the collar
    { kind: 'sphere', center: add(wp, scale(er, rCollar * 0.28)), radiusM: rCollar },
  ];

  const screws: WrapScrew[] = [];
  if (inp.rigid) {
    // set screws on the branch side of the collar
    for (const s of [-1, 1]) {
      screws.push({
        center: add(add(wp, scale(u, s * lCollar * 0.28)), scale(er, rCollar)),
        normal: er,
        radiusM: Math.max(rb * 0.35, 0.0035),
      });
    }
  }

  return { prims, screws, rigid: inp.rigid };
}
