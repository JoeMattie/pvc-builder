// Turn a Design into a flat list of solid primitives for the viewport — true-OD
// pipe cylinders per straight member, plus a hollow "bore" at every free (open)
// pipe end so pipes read as real tube with wall thickness (planfile §6). No
// rounding ball at junctions — classified fittings / heat-wraps cover real
// joints. Pure and testable without WebGL. Referenced from riglab's
// assembly/pipeModel.ts, simplified for straight members only.
import { nodeDegrees, nodeMap } from '../../design/docOps';
import { add, length, normalize, scale, sub } from '../../geometry/math3';
import type { Design, NominalSize, Vec3 } from '../../schema';
import { pipeSpec } from '../../schema';
import { anchorRendersAsTee } from './jointStyle';

/** Gap each pipe end is pulled back at a FREE (ball) pivot so the knotted cord +
 * ball read between the two eye-bolted ends (planfile §4). Shared with JointLayer. */
export const FREE_JOINT_GAP_M = 0.02;

/** How far short of the run pipe's SURFACE a wrapped/rigid branch visually stops
 * (~1"), so the wrap-arrow indicator reads between the open end and the run.
 * Shared with JointLayer's WrapJoint. */
export const WRAP_END_GAP_M = 0.0254;

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
  // free (ball) pivots pull both pipe ends back a little so the cord + ball show
  const freeNodes = new Set(design.joints.filter((j) => j.mode === 'free').map((j) => j.nodeId));
  const pullBack = (p: Vec3, toward: Vec3): Vec3 => {
    const d = sub(toward, p);
    const L = length(d);
    return L < FREE_JOINT_GAP_M * 1.5 ? p : add(p, scale(d, FREE_JOINT_GAP_M / L));
  };
  const pullBackBy = (p: Vec3, toward: Vec3, dist: number): Vec3 => {
    const d = sub(toward, p);
    const L = length(d);
    return L <= dist ? p : add(p, scale(d, dist / L));
  };
  // rigid 90° unions render as a standard socket tee (the branch sockets in full
  // and the hub sleeves over it) — no pull-back, no open bore
  const teeNodes = new Set(
    design.joints.filter((j) => anchorRendersAsTee(design, j)).map((j) => j.nodeId),
  );
  // wrapped / off-angle rigid branches stop ~1" short of the run's surface, keyed
  // by `${moverId}|${nodeId}` so only the branch end is pulled back (not a run
  // end that happens to share the node)
  const moverPull = new Map<string, number>();
  for (const j of design.joints) {
    if (j.mode !== 'wrapped' && j.mode !== 'anchor') continue;
    if (teeNodes.has(j.nodeId)) continue;
    const recv = design.members.find((m) => m.id === j.receiver);
    if (recv?.kind !== 'straight') continue;
    moverPull.set(`${j.mover}|${j.nodeId}`, pipeSpec(recv.size).odM / 2 + WRAP_END_GAP_M);
  }

  for (const m of design.members) {
    // formed members are swept tubes, rendered by FormedLayer — only straight
    // members become cylinders here
    if (m.kind !== 'straight') continue;
    let a = at(m.nodeA);
    let b = at(m.nodeB);
    if (!a || !b) continue;
    const pullA = moverPull.get(`${m.id}|${m.nodeA}`);
    const pullB = moverPull.get(`${m.id}|${m.nodeB}`);
    if (pullA) a = pullBackBy(a, b, pullA);
    if (pullB) b = pullBackBy(b, a, pullB);
    if (freeNodes.has(m.nodeA)) a = pullBack(a, b);
    if (freeNodes.has(m.nodeB)) b = pullBack(b, a);
    cylinders.push({ a, b, radiusM: pipeSpec(m.size).odM / 2, memberId: m.id, size: m.size });
  }

  // a hollow bore at every free pipe end: a straight member endpoint whose node
  // has exactly one incident member and isn't a heat-wrap branch (which the wrap
  // geometry covers)
  const degrees = nodeDegrees(design);
  const ends: PipeEnd[] = [];
  for (const m of design.members) {
    if (m.kind !== 'straight') continue;
    const spec = pipeSpec(m.size);
    for (const [end, other] of [
      [m.nodeA, m.nodeB],
      [m.nodeB, m.nodeA],
    ] as const) {
      // free-pivot ends (eye-bolt/ball) and tee branch ends (sleeved by the hub)
      // are covered; wrapped/off-angle rigid branch ends stop short and read as
      // open tube
      if ((degrees.get(end) ?? 0) !== 1 || freeNodes.has(end) || teeNodes.has(end)) continue;
      let p = at(end);
      const q = at(other);
      if (!p || !q) continue;
      const d = sub(p, q);
      if (length(d) < 1e-9) continue;
      const pull = moverPull.get(`${m.id}|${end}`);
      if (pull) p = pullBackBy(p, q, pull);
      ends.push({ center: p, dir: normalize(d), odM: spec.odM, wallM: spec.wallM, nodeId: end });
    }
  }

  return { cylinders, ends };
}
