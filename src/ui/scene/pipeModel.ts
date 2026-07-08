// Turn a Design into a flat list of solid primitives for the viewport — true-OD
// pipe cylinders per straight member, plus a hollow "bore" at every free (open)
// pipe end so pipes read as real tube with wall thickness (planfile §6). No
// rounding ball at junctions — classified fittings / heat-wraps cover real
// joints. Pure and testable without WebGL. Referenced from riglab's
// assembly/pipeModel.ts, simplified for straight members only.
import { nodeDegrees, nodeMap } from '../../design/docOps';
import { length, normalize, sub } from '../../geometry/math3';
import type { Design, NominalSize, Vec3 } from '../../schema';
import { pipeSpec } from '../../schema';

export interface PipeCylinder {
  a: Vec3;
  b: Vec3;
  radiusM: number;
  memberId: string;
  size: NominalSize;
}

/** A free (open) pipe end, rendered hollow to show the wall: `dir` points
 * outward along the pipe axis. */
export interface PipeEnd {
  center: Vec3;
  dir: Vec3;
  odM: number;
  wallM: number;
  nodeId: string;
}

export interface PipeModel {
  cylinders: PipeCylinder[];
  ends: PipeEnd[];
}

/** `posOf` optionally overrides a node's position (the eased render position);
 * it falls back to the document position. */
export function buildPipeModel(
  design: Design,
  posOf?: (id: string) => Vec3 | undefined,
): PipeModel {
  const nodes = nodeMap(design);
  const at = (id: string): Vec3 | undefined => posOf?.(id) ?? nodes.get(id)?.position;
  const cylinders: PipeCylinder[] = [];

  for (const m of design.members) {
    // formed members are swept tubes, rendered by FormedLayer — only straight
    // members become cylinders here
    if (m.kind !== 'straight') continue;
    const a = at(m.nodeA);
    const b = at(m.nodeB);
    if (!a || !b) continue;
    cylinders.push({ a, b, radiusM: pipeSpec(m.size).odM / 2, memberId: m.id, size: m.size });
  }

  // a hollow bore at every free pipe end: a straight member endpoint whose node
  // has exactly one incident member and isn't a heat-wrap branch (which the wrap
  // geometry covers)
  const degrees = nodeDegrees(design);
  const wrapNodes = new Set(design.wraps.map((w) => w.branchNode));
  const ends: PipeEnd[] = [];
  for (const m of design.members) {
    if (m.kind !== 'straight') continue;
    const spec = pipeSpec(m.size);
    for (const [end, other] of [
      [m.nodeA, m.nodeB],
      [m.nodeB, m.nodeA],
    ] as const) {
      if ((degrees.get(end) ?? 0) !== 1 || wrapNodes.has(end)) continue;
      const p = at(end);
      const q = at(other);
      if (!p || !q) continue;
      const d = sub(p, q);
      if (length(d) < 1e-9) continue;
      ends.push({ center: p, dir: normalize(d), odM: spec.odM, wallM: spec.wallM, nodeId: end });
    }
  }

  return { cylinders, ends };
}
