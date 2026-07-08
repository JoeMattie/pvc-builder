// Procedural geometry for a heat-wrapped tee (planfile §4 fabrication), the
// CAD-swap seam mirroring fittingMesh.ts. Pure + testable — no three/UI types.
//
// A branch pipe's end is heated, flattened into a rectangular strip (a round
// tube of circumference π·OD flattens to a strip ≈ π·OD/2 wide), and wrapped
// around the intact through pipe. We model that strip as a faceted band of flat
// rectangular boxes bent around the through cylinder — flattened PVC genuinely
// facets as it bends, so this both reads as "a wrapped rectangle" and is cheap.
// Rigid wraps are screwed (little discs); a natural pivot instead exposes the
// hinge axis (the through pipe's own direction).
import { add, cross, dot, length, normalize, scale, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';

/** One flat rectangular facet of the wrapped strip, as a box: local +x =
 * `lengthDir` (the chord tangent), +y = `widthDir` (the through axis), +z =
 * `thickDir` (radial outward). `size` is [length, width, thickness]. */
export interface WrapFacet {
  center: Vec3;
  lengthDir: Vec3;
  widthDir: Vec3;
  thickDir: Vec3;
  size: [number, number, number];
}

/** A screw head on a rigid wrap, drawn as a little disc facing `normal`. */
export interface WrapScrew {
  center: Vec3;
  normal: Vec3;
  radiusM: number;
}

export interface WrapMesh {
  facets: WrapFacet[];
  /** empty for a pivot wrap */
  screws: WrapScrew[];
  /** the hinge axis rod for a pivot wrap (the through-pipe direction); null when
   * rigid */
  axis: { a: Vec3; b: Vec3; radiusM: number } | null;
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

/** How far the strip wraps around the through pipe (centred on the branch). */
const WRAP_ANGLE = (240 * Math.PI) / 180;
const N_FACETS = 14;

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

  // radial toward the branch = component of the branch direction perpendicular
  // to the through axis; the strip wraps symmetrically about it
  let er = sub(inp.branchDir, scale(u, dot(inp.branchDir, u)));
  er = length(er) < 1e-6 ? anyPerp(u) : normalize(er);
  const es = normalize(cross(u, er)); // circumferential

  const th = Math.max(inp.branchODM * 0.2, 0.003); // flattened double-wall thickness
  const w = (Math.PI * inp.branchODM) / 2; // flattened strip width
  const rc = rt + 0.0006 + th / 2; // facet-centre radius (hug the pipe + tiny gap)
  const alpha = WRAP_ANGLE / 2;
  const dPhi = WRAP_ANGLE / N_FACETS;
  const chord = 2 * rc * Math.sin(dPhi / 2) * 1.03; // slight overlap so facets meet

  const facets: WrapFacet[] = [];
  for (let i = 0; i < N_FACETS; i++) {
    const phi = -alpha + (i + 0.5) * dPhi;
    const radial = add(scale(er, Math.cos(phi)), scale(es, Math.sin(phi)));
    facets.push({
      center: add(inp.wrapPoint, scale(radial, rc)),
      lengthDir: normalize(cross(u, radial)), // chord tangent
      widthDir: u,
      thickDir: radial,
      size: [chord, w, th],
    });
  }

  const screws: WrapScrew[] = [];
  if (inp.rigid) {
    // one screw near each end of the strip, where the wrapped tabs are fastened
    for (const s of [-1, 1]) {
      const phi = s * alpha * 0.85;
      const radial = add(scale(er, Math.cos(phi)), scale(es, Math.sin(phi)));
      screws.push({
        center: add(inp.wrapPoint, scale(radial, rt + th)),
        normal: radial,
        radiusM: Math.max(inp.branchODM * 0.16, 0.004),
      });
    }
  }

  const axis = inp.rigid
    ? null
    : {
        a: add(inp.wrapPoint, scale(u, -w * 0.65)),
        b: add(inp.wrapPoint, scale(u, w * 0.65)),
        radiusM: Math.max(inp.branchODM * 0.12, 0.003),
      };

  return { facets, screws, axis };
}
