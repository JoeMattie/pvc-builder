// Procedural fitting meshes from the ASTM PipeSpec table (planfile §6): turn a
// resolved fitting into composed solid primitives (socket hubs + bell lips +
// a blend body). Not CAD — a clean seam (this module) is left to swap in real
// fitting models later. Pure and unit-testable without WebGL.

import type { FittingType, ResolvedFitting } from '../../design/fittings';
import { add, scale } from '../../geometry/math3';
import { type NominalSize, pipeSpec, type Vec3 } from '../../schema';

/** hub outer radius = pipe OD/2 × wall factor (the fitting is a sleeve over the
 * pipe). */
const HUB_WALL = 1.28;
/** bell lip flare at the socket mouth. */
const BELL = 1.14;
/** hub length as a multiple of the pipe's socket depth. */
const HUB_LEN = 1.4;

const hubR = (size: NominalSize) => (pipeSpec(size).odM / 2) * HUB_WALL;
const hubLen = (size: NominalSize) => pipeSpec(size).socketDepthM * HUB_LEN;

export interface FittingCyl {
  kind: 'cylinder';
  a: Vec3;
  b: Vec3;
  radiusM: number;
}
export interface FittingSphere {
  kind: 'sphere';
  center: Vec3;
  radiusM: number;
}
export type FittingPrim = FittingCyl | FittingSphere;

export interface FittingMesh {
  nodeId: string;
  type: FittingType;
  reducing: boolean;
  prims: FittingPrim[];
}

const HAS_BODY: Record<FittingType, boolean> = {
  coupling: false, // collinear hubs already form the sleeve
  reducer: false,
  elbow45: true,
  elbow90: true,
  tee: true,
  cross: true,
};

/** Build the composed mesh for one resolved fitting. Each incident end gets a
 * socket hub + a bell lip; elbows/tees/crosses add a blend sphere at the joint
 * so the hubs read as one body. */
export function buildFittingMesh(f: ResolvedFitting): FittingMesh {
  const prims: FittingPrim[] = [];
  const p = f.position;
  let maxR = 0;
  for (const e of f.ends) {
    const r = hubR(e.size);
    maxR = Math.max(maxR, r);
    const L = hubLen(e.size);
    prims.push({ kind: 'cylinder', a: p, b: add(p, scale(e.dir, L)), radiusM: r });
    // bell lip near the socket mouth
    prims.push({
      kind: 'cylinder',
      a: add(p, scale(e.dir, L * 0.78)),
      b: add(p, scale(e.dir, L * 1.04)),
      radiusM: r * BELL,
    });
  }
  if (HAS_BODY[f.type]) prims.push({ kind: 'sphere', center: p, radiusM: maxR });
  return { nodeId: f.nodeId, type: f.type, reducing: f.reducing, prims };
}

export function buildFittingMeshes(fittings: ResolvedFitting[]): FittingMesh[] {
  return fittings.map(buildFittingMesh);
}
