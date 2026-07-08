// Procedural path for the wrapped-pivot / rigid-union indicator (planfile §4).
// Instead of a molded collar, a wrapped join reads as: the branch pipe visually
// stops ~1" short of the run, and a slender arrow leaves that open end, loops
// ONCE around the run pipe, and returns to near where it started — the visual
// grammar of "this branch swivels around the run". A rigid union (no standard
// fitting) uses the same loop but with a locking pin instead of an arrowhead.
//
// Pure + testable: no three/UI types cross this boundary.
import { add, cross, dot, length, normalize, scale, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';

export interface WrapArrowInput {
  /** the run pipe's centre-line point at the joint */
  node: Vec3;
  /** unit axis of the run pipe */
  axis: Vec3;
  /** run pipe OD / 2 */
  receiverR: number;
  /** the branch's visual (pulled-back) open end — the loop's start/return point */
  moverTip: Vec3;
  /** unit direction from `node` outward along the branch (toward its far end) */
  branchOut: Vec3;
  branchODM: number;
}

export interface WrapArrow {
  /** polyline sampling the swept loop, from the pipe end around the run and back */
  path: Vec3[];
  /** tube radius for the swept arrow body */
  tubeR: number;
  /** arrowhead position (end of `path`) */
  tip: Vec3;
  /** unit arrowhead direction */
  tipDir: Vec3;
  /** surface point on the branch side of the run — where a rigid pin sits */
  pinBase: Vec3;
  /** unit outward radial (branch side) — the pin points along this */
  pinDir: Vec3;
}

/** Any unit vector perpendicular to `u`. */
function anyPerp(u: Vec3): Vec3 {
  const t = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(u, t));
}

const LOOP_STEPS = 40;

export function buildWrapArrow(inp: WrapArrowInput): WrapArrow | null {
  const u = normalize(inp.axis);
  if (length(u) < 0.5) return null;

  // radial toward the branch (perpendicular component of the branch direction)
  let er = sub(inp.branchOut, scale(u, dot(inp.branchOut, u)));
  er = length(er) < 1e-6 ? anyPerp(u) : normalize(er);
  const eb = normalize(cross(u, er)); // the swing direction around the run

  const rWrap = inp.receiverR + Math.max(inp.branchODM * 0.12, 0.0025); // hug the run
  const pitch = Math.max(inp.branchODM * 0.5, 0.006); // helical offset so it "returns near" start
  const tubeR = Math.max(inp.branchODM * 0.09, 0.0025);

  const path: Vec3[] = [];
  path.push(inp.moverTip);
  // dip inward toward the run on the branch side, entering the loop slightly low
  path.push(add(add(inp.node, scale(er, rWrap * 1.25)), scale(u, -pitch * 0.5)));
  for (let i = 0; i <= LOOP_STEPS; i++) {
    const t = i / LOOP_STEPS;
    const th = t * Math.PI * 2;
    const radial = add(scale(er, Math.cos(th) * rWrap), scale(eb, Math.sin(th) * rWrap));
    const axial = scale(u, pitch * (t - 0.5));
    path.push(add(add(inp.node, radial), axial));
  }
  // rise back out on the branch side, offset along the run so it clears the entry
  const rise = add(add(inp.node, scale(er, rWrap * 1.25)), scale(u, pitch * 0.6));
  path.push(rise);
  const tip = add(inp.moverTip, scale(u, pitch * 0.9));
  path.push(tip);
  const tipDir = normalize(sub(tip, rise));

  // the locking pin sits on the OPPOSITE side of the run from the branch (−er),
  // so the branch's own pipe end never occludes it
  return {
    path,
    tubeR,
    tip,
    tipDir,
    pinBase: add(inp.node, scale(er, -rWrap)),
    pinDir: scale(er, -1),
  };
}
