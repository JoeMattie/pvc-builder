// Fitting auto-solve (planfile §4) — the core feature. Pure function: for each
// node, gather the incident pipe ends (unit direction pointing AWAY from the
// node along each member) and their sizes, then classify into a standard SCH 40
// fitting or flag a conflict. No three.js / UI / physics types cross this
// boundary; the output feeds both rendering (§6) and the BOM (§8).
import { dot, length, normalize, sub } from '../geometry/math3';
import type { Design, NominalSize, Vec3 } from '../schema';
import { nodeById } from './docOps';

/** Angle tolerance for classifying joint geometry (planfile §4). */
export const ANGLE_TOL_DEG = 3;

export type FittingType = 'coupling' | 'reducer' | 'elbow45' | 'elbow90' | 'tee' | 'cross';

/** One pipe end arriving at a junction node. */
export interface FittingEnd {
  memberId: string;
  /** unit direction pointing away from the node along the member */
  dir: Vec3;
  size: NominalSize;
}

export interface ResolvedFitting {
  nodeId: string;
  position: Vec3;
  type: FittingType;
  ends: FittingEnd[];
  /** true when the joint mixes sizes and resolves to a reducing variant */
  reducing: boolean;
}

export interface Conflict {
  nodeId: string;
  position: Vec3;
  reason: string;
}

export interface FittingResolution {
  fittings: ResolvedFitting[];
  conflicts: Conflict[];
}

const RAD2DEG = 180 / Math.PI;

function angleDeg(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * RAD2DEG;
}

function near(angle: number, target: number, tol = ANGLE_TOL_DEG): boolean {
  return Math.abs(angle - target) <= tol;
}

const collinear = (a: Vec3, b: Vec3) => near(angleDeg(a, b), 180);
const perpendicular = (a: Vec3, b: Vec3) => near(angleDeg(a, b), 90);

/** The incident pipe ends at every node (outgoing unit directions + sizes).
 * Degenerate (zero-length) members contribute nothing. */
export function incidentEnds(design: Design): Map<string, FittingEnd[]> {
  const byNode = new Map<string, FittingEnd[]>();
  const push = (nodeId: string, end: FittingEnd) => {
    const list = byNode.get(nodeId);
    if (list) list.push(end);
    else byNode.set(nodeId, [end]);
  };
  for (const m of design.members) {
    const a = nodeById(design, m.nodeA)?.position;
    const b = nodeById(design, m.nodeB)?.position;
    if (!a || !b) continue;
    // the incident direction is the pipe's tangent leaving the node — the whole
    // member for straight, the first/last spline segment for formed
    const towardA = m.kind === 'formed' ? (m.controlPoints[0] ?? b) : b;
    const towardB = m.kind === 'formed' ? (m.controlPoints[m.controlPoints.length - 1] ?? a) : a;
    const dirA = sub(towardA, a);
    const dirB = sub(towardB, b);
    if (length(dirA) < 1e-9 || length(dirB) < 1e-9) continue;
    push(m.nodeA, { memberId: m.id, dir: normalize(dirA), size: m.size });
    push(m.nodeB, { memberId: m.id, dir: normalize(dirB), size: m.size });
  }
  return byNode;
}

type Classified = { type: FittingType; reducing: boolean } | { conflict: string };

function allSameSize(ends: FittingEnd[]): boolean {
  return ends.every((e) => e.size === ends[0]!.size);
}

/** Find, for `i`, the index of a collinear partner among the rest (or -1). */
function collinearPartner(ends: FittingEnd[], i: number, used: Set<number>): number {
  for (let j = 0; j < ends.length; j++) {
    if (j === i || used.has(j)) continue;
    if (collinear(ends[i]!.dir, ends[j]!.dir)) return j;
  }
  return -1;
}

function classify(ends: FittingEnd[]): Classified | null {
  switch (ends.length) {
    case 1:
      return null; // open end — no auto fitting (optional cap, not applied)

    case 2: {
      const [a, b] = ends as [FittingEnd, FittingEnd];
      const ang = angleDeg(a.dir, b.dir);
      const same = a.size === b.size;
      if (near(ang, 180)) return { type: same ? 'coupling' : 'reducer', reducing: !same };
      if (near(ang, 90))
        return same
          ? { type: 'elbow90', reducing: false }
          : { conflict: 'reducing elbow is non-standard' };
      if (near(ang, 135))
        return same
          ? { type: 'elbow45', reducing: false }
          : { conflict: 'reducing elbow is non-standard' };
      return { conflict: `non-standard angle (${Math.round(ang)}°)` };
    }

    case 3: {
      // need a collinear run (same size) + a branch perpendicular to it
      const used = new Set<number>();
      let runI = -1;
      let runJ = -1;
      for (let i = 0; i < 3; i++) {
        const j = collinearPartner(ends, i, used);
        if (j >= 0) {
          runI = i;
          runJ = j;
          break;
        }
      }
      if (runI < 0) return { conflict: 'three pipes with no straight run' };
      const branch = ends[3 - runI - runJ]!;
      const run = ends[runI]!;
      const runMate = ends[runJ]!;
      if (run.size !== runMate.size) return { conflict: 'tee run mixes sizes' };
      if (!perpendicular(run.dir, branch.dir))
        return { conflict: 'tee branch is not perpendicular' };
      return { type: 'tee', reducing: branch.size !== run.size };
    }

    case 4: {
      // two collinear pairs whose axes are perpendicular = a cross
      const used = new Set<number>();
      const axes: Vec3[] = [];
      for (let i = 0; i < 4; i++) {
        if (used.has(i)) continue;
        const j = collinearPartner(ends, i, used);
        if (j < 0) return { conflict: 'four pipes do not form two straight runs' };
        used.add(i);
        used.add(j);
        axes.push(ends[i]!.dir);
      }
      if (axes.length !== 2) return { conflict: 'four pipes do not form a cross' };
      if (!perpendicular(axes[0]!, axes[1]!))
        return { conflict: 'cross runs are not perpendicular' };
      return { type: 'cross', reducing: !allSameSize(ends) };
    }

    default:
      return { conflict: `${ends.length} pipes meet — no standard fitting` };
  }
}

/** Resolve every junction into a standard fitting or a conflict. Pure; feeds
 * rendering and the BOM. A node carrying a heat-formed pivot will be exempt
 * from Phase 4 (the pivot IS its fitting) — no pivots exist yet. */
export function resolveFittings(design: Design): FittingResolution {
  const ends = incidentEnds(design);
  const nodePos = new Map(design.nodes.map((n) => [n.id, n.position]));
  const fittings: ResolvedFitting[] = [];
  const conflicts: Conflict[] = [];

  for (const [nodeId, list] of ends) {
    const position = nodePos.get(nodeId);
    if (!position) continue;
    const result = classify(list);
    if (!result) continue;
    if ('conflict' in result) {
      conflicts.push({ nodeId, position, reason: result.conflict });
    } else {
      fittings.push({ nodeId, position, type: result.type, ends: list, reducing: result.reducing });
    }
  }
  return { fittings, conflicts };
}
