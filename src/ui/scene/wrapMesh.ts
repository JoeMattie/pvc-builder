// Procedural geometry for a heat-wrapped tee (planfile §4 fabrication), the
// CAD-swap seam mirroring fittingMesh.ts. Pure + testable — no three/UI types.
//
// A branch pipe's end is heated, flattened into a rectangular strip (a round
// tube of circumference π·OD flattens to a strip ≈ π·OD/2 wide), and wrapped
// once, smoothly, around the intact through pipe. We model that as a rectangular
// cross-section swept along a single-turn HELIX around the through cylinder — a
// solid ribbon (inner + outer + edges + caps) built as a triangle mesh. Rigid
// wraps get screw discs at the overlapping seam; a pivot wrap is rendered by the
// layer in the accent tint (the hinge barrel about the run).
import { add, cross, dot, length, normalize, scale, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';

/** A screw head on a rigid wrap, drawn as a little disc facing `normal`. */
export interface WrapScrew {
  center: Vec3;
  normal: Vec3;
  radiusM: number;
}

export interface WrapMesh {
  /** flat triangle-mesh vertex positions [x,y,z, …] for the wrapped strip */
  positions: number[];
  /** triangle indices into `positions` */
  indices: number[];
  /** empty for a pivot wrap */
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

/** Segments around the single turn (smoothness of the helix). */
const N_SEG = 80;

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
  // to the through axis; the wrap seam sits on this (the branch) side
  let er = sub(inp.branchDir, scale(u, dot(inp.branchDir, u)));
  er = length(er) < 1e-6 ? anyPerp(u) : normalize(er);
  const es = normalize(cross(u, er)); // circumferential

  const th = Math.max(inp.branchODM * 0.16, 0.0022); // flattened double-wall thickness
  const w = (Math.PI * inp.branchODM) / 2; // flattened strip width (along the run)
  const rin = rt + 0.0004; // inner surface hugs the pipe
  const rout = rin + th;
  const pitch = w * 0.8; // how far the helix advances along the run over one turn

  // Each ring = the rectangular cross-section [innerL, outerL, outerR, innerR],
  // swept once around (φ: 0 → 2π) while advancing `pitch` along the run.
  const positions: number[] = [];
  const push = (p: Vec3): void => {
    positions.push(p.x, p.y, p.z);
  };
  for (let i = 0; i <= N_SEG; i++) {
    const t = i / N_SEG;
    const phi = t * Math.PI * 2;
    const adv = (t - 0.5) * pitch;
    const radial = add(scale(er, Math.cos(phi)), scale(es, Math.sin(phi)));
    const uL = adv - w / 2;
    const uR = adv + w / 2;
    const base = (uOff: number, r: number): Vec3 =>
      add(add(inp.wrapPoint, scale(u, uOff)), scale(radial, r));
    push(base(uL, rin));
    push(base(uL, rout));
    push(base(uR, rout));
    push(base(uR, rin));
  }

  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < N_SEG; i++) {
    const r0 = i * 4;
    const r1 = (i + 1) * 4;
    quad(r0 + 0, r1 + 0, r1 + 1, r0 + 1); // left edge
    quad(r0 + 1, r1 + 1, r1 + 2, r0 + 2); // outer face
    quad(r0 + 2, r1 + 2, r1 + 3, r0 + 3); // right edge
    quad(r0 + 3, r1 + 3, r1 + 0, r0 + 0); // inner face
  }
  // end caps (the two rectangle cross-sections)
  const last = N_SEG * 4;
  indices.push(0, 2, 1, 0, 3, 2);
  indices.push(last + 0, last + 1, last + 2, last + 0, last + 2, last + 3);

  const screws: WrapScrew[] = [];
  if (inp.rigid) {
    // two screws at the branch-side seam where the wrap overlaps + is fastened
    for (const s of [-1, 1]) {
      screws.push({
        center: add(add(inp.wrapPoint, scale(u, s * w * 0.22)), scale(er, rout + 0.001)),
        normal: er,
        radiusM: Math.max(inp.branchODM * 0.14, 0.0035),
      });
    }
  }

  return { positions, indices, screws, rigid: inp.rigid };
}
