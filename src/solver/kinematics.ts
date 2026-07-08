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

// ── closed loops (planfile §5: the tree FK can't close a 4-bar) ──────────────

function quatConj(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Signed angle of the relative rotation (B relative to A) about `axis`. */
function relAngleAbout(TA: Transform, TB: Transform, axis: Vec3): number {
  const rel = mulQ(TB.r, quatConj(TA.r));
  const u = normalize(axis);
  return 2 * Math.atan2(rel.x * u.x + rel.y * u.y + rel.z * u.z, rel.w);
}

/** Solve a small dense linear system A·x = b (Gaussian elimination + partial
 * pivoting). Returns null if singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (Math.abs(M[piv]![c]!) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

function sumSq(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return s;
}

/** Loop-closure solver. The spanning-tree pivots (`treeIds`) are the free
 * variables; a damped Gauss-Newton (Levenberg-Marquardt) drives:
 *   • closure — each loop-closing pivot's node must agree between its two bodies
 *     (this is what keeps every member length exact around the loop),
 *   • regularization — tree angles stay near their slider targets,
 *   • drag (optional) — the dragged node reaches its target.
 * Returns resolved angles for ALL pivots (tree from the solve; loop pivots
 * measured from the closed geometry) + the final FK. */
function solveLoops(
  ctx: Ctx,
  design: Design,
  targets: Record<string, number>,
  loopPivots: Pivot[],
  treeIds: string[],
  dragTarget?: { nodeId: string; position: Vec3 },
): { angles: Record<string, number>; converged: boolean; fk: FKResult } {
  const n = treeIds.length;
  // closure must dominate so every member length stays exact; the angle/​drag
  // pulls only pick WHERE on the (reduced-DOF) loop manifold to settle
  const W_CLOSE = 40;
  const W_REG = 0.05;
  const W_DRAG = 2;
  const x = treeIds.map((id) => targets[id] ?? 0);

  const anglesFrom = (xv: number[]): Record<string, number> => {
    const a = { ...targets };
    treeIds.forEach((id, i) => {
      a[id] = xv[i]!;
    });
    return a;
  };
  const residual = (xv: number[]): number[] => {
    const fk = runFK(ctx, anglesFrom(xv));
    const r: number[] = [];
    for (const p of loopPivots) {
      const nd = ctx.nodePos.get(p.nodeId);
      const ba = ctx.bodyOfMember.get(p.memberA);
      const bb = ctx.bodyOfMember.get(p.memberB);
      const ta = ba ? fk.T.get(ba) : undefined;
      const tb = bb ? fk.T.get(bb) : undefined;
      if (!nd || !ta || !tb) continue;
      const na = applyT(ta, nd);
      const nb = applyT(tb, nd);
      r.push((na.x - nb.x) * W_CLOSE, (na.y - nb.y) * W_CLOSE, (na.z - nb.z) * W_CLOSE);
    }
    for (let i = 0; i < n; i++) r.push((xv[i]! - (targets[treeIds[i]!] ?? 0)) * W_REG);
    // loop pivots have no tree variable — pull their *measured* angle toward the
    // slider target so driving ANY pivot (not just tree ones) moves the loop
    for (const p of loopPivots) {
      const ba = ctx.bodyOfMember.get(p.memberA);
      const bb = ctx.bodyOfMember.get(p.memberB);
      const ta = ba ? fk.T.get(ba) : undefined;
      const tb = bb ? fk.T.get(bb) : undefined;
      if (!ta || !tb) continue;
      const cur = relAngleAbout(ta, tb, normalize(rotate(ta.r, p.axis)));
      const diff = cur - (targets[p.id] ?? 0);
      r.push(Math.atan2(Math.sin(diff), Math.cos(diff)) * W_REG);
    }
    if (dragTarget) {
      const e = worldNodePos(dragTarget.nodeId, ctx, fk.T);
      r.push(
        (e.x - dragTarget.position.x) * W_DRAG,
        (e.y - dragTarget.position.y) * W_DRAG,
        (e.z - dragTarget.position.z) * W_DRAG,
      );
    }
    return r;
  };

  let r = residual(x);
  let cost = sumSq(r);
  let lambda = 1e-3;
  const EPS = 1e-6;
  for (let it = 0; it < 30 && cost > 1e-14; it++) {
    const m = r.length;
    // numerical Jacobian (m × n)
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xj = x.slice();
      xj[j]! += EPS;
      const rj = residual(xj);
      for (let i = 0; i < m; i++) J[i]![j] = (rj[i]! - r[i]!) / EPS;
    }
    // normal equations JᵀJ (n × n) and Jᵀr (n)
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[i]![a]! * J[i]![b]!;
        JtJ[a]![b] = s;
      }
      let s = 0;
      for (let i = 0; i < m; i++) s += J[i]![a]! * r[i]!;
      Jtr[a] = s;
    }
    let stepped = false;
    for (let tries = 0; tries < 6; tries++) {
      const damped = JtJ.map((row, i) =>
        row.map((v, k) => (k === i ? v + lambda * (Math.abs(v) || 1) : v)),
      );
      const dx = solveLinear(
        damped,
        Jtr.map((v) => -v),
      );
      if (dx) {
        const xn = x.map((v, i) => v + dx[i]!);
        const rn = residual(xn);
        const cn = sumSq(rn);
        if (cn < cost) {
          for (let i = 0; i < n; i++) x[i] = xn[i]!;
          r = rn;
          cost = cn;
          lambda = Math.max(lambda * 0.5, 1e-10);
          stepped = true;
          break;
        }
      }
      lambda *= 3;
    }
    if (!stepped) break;
  }

  const fk = runFK(ctx, anglesFrom(x));
  const angles: Record<string, number> = {};
  const treeSet = new Set(treeIds);
  for (const p of design.pivots) {
    if (treeSet.has(p.id)) {
      angles[p.id] = x[treeIds.indexOf(p.id)]!;
      continue;
    }
    const ba = ctx.bodyOfMember.get(p.memberA);
    const bb = ctx.bodyOfMember.get(p.memberB);
    const ta = ba ? fk.T.get(ba) : undefined;
    const tb = bb ? fk.T.get(bb) : undefined;
    angles[p.id] =
      ta && tb ? relAngleAbout(ta, tb, normalize(rotate(ta.r, p.axis))) : (targets[p.id] ?? 0);
  }
  return { angles, converged: cost < 1e-8, fk };
}

/** Whether every axis in the list is parallel (‖a×b‖ ≈ 0) — i.e. the component
 * is a planar mechanism, whose loops need the planar Grübler count. */
function allParallel(axes: Vec3[]): boolean {
  if (axes.length < 2) return true;
  const a0 = normalize(axes[0]!);
  for (let i = 1; i < axes.length; i++) {
    if (length(cross(a0, normalize(axes[i]!))) > 1e-3) return false;
  }
  return true;
}

/** Grübler mobility per connected component. A component whose pivot axes are
 * all parallel is a PLANAR mechanism — its loops are over-counted by the spatial
 * formula (a planar 4-bar reads as −2 DOF), so it uses the planar count
 * 3·(b−1) − 2·j; otherwise the spatial 6·(b−1) − 5·j. Over-constrained means the
 * (correct) DOF is negative, not merely "has a loop". */
function mobility(ctx: Ctx): { dof: number; overConstrained: boolean } {
  const seen = new Set<string>();
  let dof = 0;
  let over = false;
  for (const start of ctx.bodies) {
    if (seen.has(start)) continue;
    let b = 0;
    const stack = [start];
    seen.add(start);
    const pivotSeen = new Set<string>();
    const axes: Vec3[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      b++;
      for (const e of ctx.adj.get(cur) ?? []) {
        if (!pivotSeen.has(e.pivot.id)) {
          pivotSeen.add(e.pivot.id);
          axes.push(e.pivot.axis);
        }
        if (!seen.has(e.other)) {
          seen.add(e.other);
          stack.push(e.other);
        }
      }
    }
    const j = pivotSeen.size;
    const planar = allParallel(axes);
    const compDof = planar ? 3 * (b - 1) - 2 * j : 6 * (b - 1) - 5 * j;
    dof += compDof;
    if (compDof < 0) over = true;
  }
  return { dof, overConstrained: over };
}

export function solvePose(
  design: Design,
  inputs: { pivotAngles: Record<string, number>; dragTarget?: { nodeId: string; position: Vec3 } },
): PoseResult {
  const ctx = buildCtx(design);
  // which pivots are spanning-tree edges vs loop-closing (back) edges
  const refFK = runFK(ctx, inputs.pivotAngles);
  const treeIds = [...refFK.frames.keys()];
  const loopPivots = design.pivots.filter((p) => {
    const ba = ctx.bodyOfMember.get(p.memberA);
    const bb = ctx.bodyOfMember.get(p.memberB);
    return !!ba && !!bb && ba !== bb && !refFK.frames.has(p.id);
  });

  let angles = { ...inputs.pivotAngles };
  let converged = true;
  let fk: FKResult;
  if (loopPivots.length > 0) {
    // closed loops: tree FK can't keep them shut — run loop closure so every
    // member length stays exact and driving one pivot pushes the others
    const r = solveLoops(ctx, design, inputs.pivotAngles, loopPivots, treeIds, inputs.dragTarget);
    angles = r.angles;
    converged = r.converged;
    fk = r.fk;
  } else {
    if (inputs.dragTarget) {
      const r = ccd(ctx, angles, inputs.dragTarget.nodeId, inputs.dragTarget.position);
      angles = r.angles;
      converged = r.converged;
    }
    fk = runFK(ctx, angles);
  }
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
    // a closed loop (fk.overConstrained) is NOT over-constrained on its own —
    // only a negative-mobility mechanism is (mobility() decides, planar-aware)
    overConstrained: mob.overConstrained,
    converged,
  };
}
