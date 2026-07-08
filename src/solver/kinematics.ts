// Deterministic kinematics behind the solver boundary (planfile §5). When
// lengths are locked, members are rigid and only pivots move: welded members
// form rigid bodies, pivots are revolute joints between bodies, and the
// mechanism is a tree (or forest) rooted at a fixed base. Forward kinematics
// places every body; drag runs cyclic-coordinate-descent IK over the pivots on
// the path to the dragged node. Rigid transforms preserve every member length
// exactly — which is why this is deterministic closed-form, not a physics
// engine (planfile §5: "trust the tests, not the engine"). No three.js / engine
// types here.
import {
  add,
  cross,
  dot,
  IDENTITY_Q,
  length,
  mulQ,
  normalize,
  rotate,
  scale,
  sub,
} from '../geometry/math3';
import type { Design, Pivot, Quaternion, Vec3 } from '../schema';

export interface Transform {
  r: Quaternion;
  t: Vec3;
}
const IDENTITY_T: Transform = { r: IDENTITY_Q, t: { x: 0, y: 0, z: 0 } };

function applyT(T: Transform, p: Vec3): Vec3 {
  return add(rotate(T.r, p), T.t);
}

function axisAngleQuat(axis: Vec3, angle: number): Quaternion {
  const u = normalize(axis);
  const s = Math.sin(angle / 2);
  return { x: u.x * s, y: u.y * s, z: u.z * s, w: Math.cos(angle / 2) };
}

function clampAngle(angle: number, limits?: { minRad: number; maxRad: number }): number {
  if (!limits) return angle;
  return Math.max(limits.minRad, Math.min(limits.maxRad, angle));
}

// ── rigid bodies (union-find over welded joints) ────────────────────────────
class UnionFind {
  private parent = new Map<string, string>();
  add(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== r) {
      const next = this.parent.get(c)!;
      this.parent.set(c, r);
      c = next;
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

interface Ctx {
  bodyOfMember: Map<string, string>;
  incident: Map<string, string[]>; // nodeId → member ids
  nodePos: Map<string, Vec3>;
  bodies: string[];
  adj: Map<string, Array<{ pivot: Pivot; other: string }>>;
}

function buildCtx(design: Design): Ctx {
  const uf = new UnionFind();
  for (const m of design.members) uf.add(m.id);
  const incident = new Map<string, string[]>();
  for (const m of design.members) {
    for (const nid of [m.nodeA, m.nodeB]) {
      const list = incident.get(nid);
      if (list) list.push(m.id);
      else incident.set(nid, [m.id]);
    }
  }
  const pivotNodes = new Set(design.pivots.map((p) => p.nodeId));
  for (const [nid, mem] of incident) {
    if (pivotNodes.has(nid)) continue; // don't weld across a pivot
    for (let i = 1; i < mem.length; i++) uf.union(mem[0]!, mem[i]!);
  }
  const bodyOfMember = new Map<string, string>();
  for (const m of design.members) bodyOfMember.set(m.id, uf.find(m.id));
  const bodies = [...new Set([...bodyOfMember.values()])].sort();

  const adj = new Map<string, Array<{ pivot: Pivot; other: string }>>();
  for (const b of bodies) adj.set(b, []);
  for (const pv of design.pivots) {
    const ba = bodyOfMember.get(pv.memberA);
    const bb = bodyOfMember.get(pv.memberB);
    if (!ba || !bb || ba === bb) continue;
    adj.get(ba)?.push({ pivot: pv, other: bb });
    adj.get(bb)?.push({ pivot: pv, other: ba });
  }
  const nodePos = new Map(design.nodes.map((n) => [n.id, n.position] as const));
  return { bodyOfMember, incident, nodePos, bodies, adj };
}

interface FKResult {
  T: Map<string, Transform>;
  overConstrained: boolean;
  /** per pivot on a tree edge: its world axis + point, and the child body */
  frames: Map<string, { axis: Vec3; point: Vec3; child: string }>;
  parentPivotOf: Map<string, string>;
}

/** Forward kinematics: place every body from the pivot angles. Roots each
 * connected component (smallest body id) at the design pose. */
function runFK(ctx: Ctx, angles: Record<string, number>): FKResult {
  const T = new Map<string, Transform>();
  const frames = new Map<string, { axis: Vec3; point: Vec3; child: string }>();
  const parentPivotOf = new Map<string, string>();
  let overConstrained = false;

  for (const root of ctx.bodies) {
    if (T.has(root)) continue;
    T.set(root, IDENTITY_T);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift()!;
      const Tc = T.get(cur)!;
      const edges = [...(ctx.adj.get(cur) ?? [])].sort((a, b) =>
        a.pivot.id < b.pivot.id ? -1 : 1,
      );
      for (const { pivot, other } of edges) {
        if (T.has(other)) {
          if (parentPivotOf.get(cur) !== pivot.id) overConstrained = true; // loop
          continue;
        }
        const designPivotPos = ctx.nodePos.get(pivot.nodeId) ?? { x: 0, y: 0, z: 0 };
        const worldPivot = applyT(Tc, designPivotPos);
        const axisWorld = normalize(rotate(Tc.r, pivot.axis));
        const angle = clampAngle(angles[pivot.id] ?? pivot.angleRad ?? 0, pivot.limits);
        const q = axisAngleQuat(axisWorld, angle);
        const Tchild: Transform = {
          r: mulQ(q, Tc.r),
          t: add(rotate(q, sub(Tc.t, worldPivot)), worldPivot),
        };
        T.set(other, Tchild);
        frames.set(pivot.id, { axis: axisWorld, point: worldPivot, child: other });
        parentPivotOf.set(other, pivot.id);
        queue.push(other);
      }
    }
  }
  return { T, overConstrained, frames, parentPivotOf };
}

function worldNodePos(nodeId: string, ctx: Ctx, T: Map<string, Transform>): Vec3 {
  const design = ctx.nodePos.get(nodeId);
  if (!design) return { x: 0, y: 0, z: 0 };
  const memberId = ctx.incident.get(nodeId)?.[0];
  const body = memberId ? ctx.bodyOfMember.get(memberId) : undefined;
  const t = body ? T.get(body) : undefined;
  return t ? applyT(t, design) : design;
}

/** Pivots on the path from the dragged node's body up to its component root,
 * ordered effector → root (cyclic-coordinate-descent order). */
function pathPivots(ctx: Ctx, fk: FKResult, nodeId: string): Pivot[] {
  const memberId = ctx.incident.get(nodeId)?.[0];
  let body = memberId ? ctx.bodyOfMember.get(memberId) : undefined;
  const pivotById = new Map<string, Pivot>();
  for (const edges of ctx.adj.values()) for (const e of edges) pivotById.set(e.pivot.id, e.pivot);
  const out: Pivot[] = [];
  while (body) {
    const pid = fk.parentPivotOf.get(body);
    if (!pid) break;
    const pv = pivotById.get(pid);
    if (!pv) break;
    out.push(pv);
    // move to the other (parent) body of this pivot
    const frame = fk.frames.get(pid);
    const child = frame?.child;
    const ba = ctx.bodyOfMember.get(pv.memberA);
    const bb = ctx.bodyOfMember.get(pv.memberB);
    body = child === ba ? bb : ba;
  }
  return out;
}

const CCD_ITERS = 24;
const CCD_TOL = 1e-7;

/** Cyclic-coordinate-descent IK: adjust the path pivots so `nodeId` reaches
 * `target` (as near as the mechanism allows). Rigid transforms mean every
 * member length is preserved exactly regardless of convergence. */
function ccd(
  ctx: Ctx,
  angles: Record<string, number>,
  nodeId: string,
  target: Vec3,
): { angles: Record<string, number>; converged: boolean } {
  const a = { ...angles };
  let converged = false;
  for (let it = 0; it < CCD_ITERS; it++) {
    const fk = runFK(ctx, a);
    if (length(sub(worldNodePos(nodeId, ctx, fk.T), target)) < CCD_TOL) {
      converged = true;
      break;
    }
    for (const pv of pathPivots(ctx, fk, nodeId)) {
      const cur = runFK(ctx, a);
      const frame = cur.frames.get(pv.id);
      if (!frame) continue;
      const e = worldNodePos(nodeId, ctx, cur.T);
      const { axis, point } = frame;
      const eV = sub(e, point);
      const tV = sub(target, point);
      const eP = sub(eV, scale(axis, dot(eV, axis)));
      const tP = sub(tV, scale(axis, dot(tV, axis)));
      if (length(eP) < 1e-9 || length(tP) < 1e-9) continue;
      const delta = Math.atan2(dot(cross(eP, tP), axis), dot(eP, tP));
      a[pv.id] = clampAngle((a[pv.id] ?? pv.angleRad ?? 0) + delta, pv.limits);
    }
  }
  return { angles: a, converged };
}

export interface PoseResult {
  nodePositions: Record<string, Vec3>;
  memberTransforms: Record<string, { position: Vec3; quaternion: Quaternion }>;
  pivotAngles: Record<string, number>;
  mobilityDof: number;
  overConstrained: boolean;
  converged: boolean;
}

/** Grübler-style spatial mobility, summed per connected component:
 * 6·(bodies − 1) − 5·(revolute pivots). */
function mobility(ctx: Ctx): { dof: number; overConstrained: boolean } {
  const seen = new Set<string>();
  let dof = 0;
  let over = false;
  for (const start of ctx.bodies) {
    if (seen.has(start)) continue;
    let b = 0;
    let j = 0;
    const stack = [start];
    seen.add(start);
    const pivotSeen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      b++;
      for (const e of ctx.adj.get(cur) ?? []) {
        if (!pivotSeen.has(e.pivot.id)) {
          pivotSeen.add(e.pivot.id);
          j++;
        }
        if (!seen.has(e.other)) {
          seen.add(e.other);
          stack.push(e.other);
        }
      }
    }
    dof += 6 * (b - 1) - 5 * j;
    if (j > b - 1) over = true; // a redundant loop
  }
  return { dof, overConstrained: over };
}

export function solvePose(
  design: Design,
  inputs: { pivotAngles: Record<string, number>; dragTarget?: { nodeId: string; position: Vec3 } },
): PoseResult {
  const ctx = buildCtx(design);
  let angles = { ...inputs.pivotAngles };
  let converged = true;
  if (inputs.dragTarget) {
    const r = ccd(ctx, angles, inputs.dragTarget.nodeId, inputs.dragTarget.position);
    angles = r.angles;
    converged = r.converged;
  }
  const fk = runFK(ctx, angles);
  const nodePositions: Record<string, Vec3> = {};
  for (const n of design.nodes) nodePositions[n.id] = worldNodePos(n.id, ctx, fk.T);
  const memberTransforms: Record<string, { position: Vec3; quaternion: Quaternion }> = {};
  for (const m of design.members) {
    const body = ctx.bodyOfMember.get(m.id);
    const t = body ? fk.T.get(body) : undefined;
    memberTransforms[m.id] = t
      ? { position: t.t, quaternion: t.r }
      : { position: { x: 0, y: 0, z: 0 }, quaternion: IDENTITY_Q };
  }
  const resolvedAngles: Record<string, number> = {};
  for (const pv of design.pivots) {
    resolvedAngles[pv.id] = clampAngle(angles[pv.id] ?? pv.angleRad ?? 0, pv.limits);
  }
  const mob = mobility(ctx);
  return {
    nodePositions,
    memberTransforms,
    pivotAngles: resolvedAngles,
    mobilityDof: mob.dof,
    overConstrained: mob.overConstrained || fk.overConstrained,
    converged,
  };
}
