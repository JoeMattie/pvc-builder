// Turn a Design into a flat list of solid primitives for the viewport — true-OD
// pipe cylinders per straight member, plus a rounding sphere at each junction
// node so corners read as connected joints (planfile §6). Pure and testable
// without WebGL; fittings arrive in Phase 2. Referenced from riglab's
// assembly/pipeModel.ts, simplified for straight members only.
import { nodeDegrees, nodeMap } from '../../design/docOps';
import type { Design, NominalSize, Vec3 } from '../../schema';
import { pipeSpec } from '../../schema';

export interface PipeCylinder {
  a: Vec3;
  b: Vec3;
  radiusM: number;
  memberId: string;
  size: NominalSize;
}

export interface PipeJoint {
  center: Vec3;
  radiusM: number;
  nodeId: string;
}

export interface PipeModel {
  cylinders: PipeCylinder[];
  joints: PipeJoint[];
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
  const maxRadiusAtNode = new Map<string, number>();

  for (const m of design.members) {
    const radiusM = pipeSpec(m.size).odM / 2;
    // register the OD at both endpoints so joints size to the thickest member
    // (both straight and formed)
    for (const id of [m.nodeA, m.nodeB]) {
      maxRadiusAtNode.set(id, Math.max(maxRadiusAtNode.get(id) ?? 0, radiusM));
    }
    // formed members are swept tubes, rendered by FormedLayer — only straight
    // members become cylinders here
    if (m.kind !== 'straight') continue;
    const a = at(m.nodeA);
    const b = at(m.nodeB);
    if (!a || !b) continue;
    cylinders.push({ a, b, radiusM, memberId: m.id, size: m.size });
  }

  // one rounding sphere at every node that carries pipe, sized to the largest
  // incident OD so the joint sits flush with its thickest member
  const degrees = nodeDegrees(design);
  const joints: PipeJoint[] = [];
  for (const n of design.nodes) {
    const deg = degrees.get(n.id) ?? 0;
    const r = maxRadiusAtNode.get(n.id);
    if (deg < 1 || r === undefined) continue;
    joints.push({ center: at(n.id) ?? n.position, radiusM: r, nodeId: n.id });
  }

  return { cylinders, joints };
}
