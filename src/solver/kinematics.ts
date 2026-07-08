// Deterministic kinematics behind the solver boundary (planfile §5). When
// lengths are locked, members are rigid and only pivot JOINTS move: welded
// members (and rigid/anchor joints) form rigid bodies, while pivot joints are
// either WRAPPED (a revolute joint about the receiver pipe's own axis, 1 DOF) or
// FREE (a spherical ball joint, 3 DOF). Forward kinematics places every body;
// drag runs cyclic-coordinate-descent IK over the joints on the path to the
// dragged node. Rigid transforms preserve every member length exactly — which is
// why this is deterministic closed-form, not a physics engine (planfile §5:
// "trust the tests, not the engine"). No three.js / engine types here.
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
import type { Design, Joint, Quaternion, Vec3 } from '../schema';

export interface Transform {
  r: Quaternion;
  t: Vec3;
}
const IDENTITY_T: Transform = { r: IDENTITY_Q, t: { x: 0, y: 0, z: 0 } };

/** Per-joint articulation state: wrapped joints read an angle, free joints read
 * a relative orientation quaternion (a world-frame rotation of the mover vs the
 * receiver). */
interface JointState {
  angles: Record<string, number>;
  orient: Record<string, Quaternion>;
}

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
  adj: Map<string, Array<{ joint: Joint; other: string }>>;
  /** design-space rotation axis for each WRAPPED joint (the receiver's direction) */
  jointAxis: Map<string, Vec3>;
}

/** Design-space unit direction of a wrapped joint's receiver pipe at its node. */
function receiverDesignDir(design: Design, joint: Joint): Vec3 {
  const recv = design.members.find((m) => m.id === joint.receiver);
  const pos = (id: string): Vec3 | undefined => design.nodes.find((n) => n.id === id)?.position;
  if (recv?.kind !== 'straight') return { x: 1, y: 0, z: 0 };
  // end-to-end: node is an endpoint → axis points down the receiver from it;
  // on-body: node lies on the span → use the run's own nodeA→nodeB direction
  const a = recv.nodeB === joint.nodeId ? pos(recv.nodeB) : pos(recv.nodeA);
  const b = recv.nodeB === joint.nodeId ? pos(recv.nodeA) : pos(recv.nodeB);
  if (!a || !b) return { x: 1, y: 0, z: 0 };
  const d = sub(b, a);
  return length(d) < 1e-9 ? { x: 1, y: 0, z: 0 } : normalize(d);
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
  // a member that is the MOVER of a pivot (non-anchor) joint at a node is not
  // welded to the others there — it hangs off the receiver via the joint edge.
  const pivotMover = new Set<string>();
  for (const j of design.joints) {
    if (j.mode !== 'anchor') pivotMover.add(`${j.nodeId}|${j.mover}`);
  }
  for (const [nid, mem] of incident) {
    const weldable = mem.filter((mid) => !pivotMover.has(`${nid}|${mid}`));
    for (let i = 1; i < weldable.length; i++) uf.union(weldable[0]!, weldable[i]!);
  }
  // on-body anchors (screwed tees) weld the branch rigidly into the run body
  for (const j of design.joints) {
    if (j.mode === 'anchor' && j.onBody) uf.union(j.receiver, j.mover);
  }

  const bodyOfMember = new Map<string, string>();
  for (const m of design.members) bodyOfMember.set(m.id, uf.find(m.id));
  const bodies = [...new Set([...bodyOfMember.values()])].sort();

  const adj = new Map<string, Array<{ joint: Joint; other: string }>>();
  const jointAxis = new Map<string, Vec3>();
  for (const b of bodies) adj.set(b, []);
  for (const j of design.joints) {
    if (j.mode === 'anchor') continue; // a weld, not a moving edge
    const ba = bodyOfMember.get(j.receiver);
    const bb = bodyOfMember.get(j.mover);
    if (!ba || !bb || ba === bb) continue;
    if (j.mode === 'wrapped') jointAxis.set(j.id, receiverDesignDir(design, j));
    adj.get(ba)?.push({ joint: j, other: bb });
    adj.get(bb)?.push({ joint: j, other: ba });
  }
  const nodePos = new Map(design.nodes.map((n) => [n.id, n.position] as const));
  return { bodyOfMember, incident, nodePos, bodies, adj, jointAxis };
}

interface FKResult {
  T: Map<string, Transform>;
  overConstrained: boolean;
  /** per joint on a tree edge: its world frame + the child body */
  frames: Map<string, { axis: Vec3 | null; point: Vec3; child: string; mode: Joint['mode'] }>;
  parentJointOf: Map<string, string>;
}

/** The world rotation a joint applies to its child, given the parent frame. */
function jointRotation(joint: Joint, parent: Transform, ctx: Ctx, state: JointState): Quaternion {
  if (joint.mode === 'free') {
    return state.orient[joint.id] ?? joint.orientation ?? IDENTITY_Q;
  }
  const axisDesign = ctx.jointAxis.get(joint.id) ?? { x: 1, y: 0, z: 0 };
  const axisWorld = normalize(rotate(parent.r, axisDesign));
  const angle = clampAngle(state.angles[joint.id] ?? joint.angleRad ?? 0, joint.limits);
  return axisAngleQuat(axisWorld, angle);
}

/** Forward kinematics: place every body from the joint state. Roots each
 * connected component (smallest body id) at the design pose. */
function runFK(ctx: Ctx, state: JointState): FKResult {
  const T = new Map<string, Transform>();
  const frames = new Map<
    string,
    { axis: Vec3 | null; point: Vec3; child: string; mode: Joint['mode'] }
  >();
  const parentJointOf = new Map<string, string>();
  let overConstrained = false;

  for (const root of ctx.bodies) {
    if (T.has(root)) continue;
    T.set(root, IDENTITY_T);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift()!;
      const Tc = T.get(cur)!;
      const edges = [...(ctx.adj.get(cur) ?? [])].sort((a, b) =>
        a.joint.id < b.joint.id ? -1 : 1,
      );
      for (const { joint, other } of edges) {
        if (T.has(other)) {
          if (parentJointOf.get(cur) !== joint.id) overConstrained = true; // loop
          continue;
        }
        const designPivotPos = ctx.nodePos.get(joint.nodeId) ?? { x: 0, y: 0, z: 0 };
        const worldPivot = applyT(Tc, designPivotPos);
        const q = jointRotation(joint, Tc, ctx, state);
        const axisWorld =
          joint.mode === 'wrapped'
            ? normalize(rotate(Tc.r, ctx.jointAxis.get(joint.id) ?? { x: 1, y: 0, z: 0 }))
            : null;
        const Tchild: Transform = {
          r: mulQ(q, Tc.r),
          t: add(rotate(q, sub(Tc.t, worldPivot)), worldPivot),
        };
        T.set(other, Tchild);
        frames.set(joint.id, {
          axis: axisWorld,
          point: worldPivot,
          child: other,
          mode: joint.mode,
        });
        parentJointOf.set(other, joint.id);
        queue.push(other);
      }
    }
  }
  return { T, overConstrained, frames, parentJointOf };
}

function worldNodePos(nodeId: string, ctx: Ctx, T: Map<string, Transform>): Vec3 {
  const design = ctx.nodePos.get(nodeId);
  if (!design) return { x: 0, y: 0, z: 0 };
  const memberId = ctx.incident.get(nodeId)?.[0];
  const body = memberId ? ctx.bodyOfMember.get(memberId) : undefined;
  const t = body ? T.get(body) : undefined;
  return t ? applyT(t, design) : design;
}

/** Joints on the path from the dragged node's body up to its component root,
 * ordered effector → root (cyclic-coordinate-descent order). */
function pathJoints(ctx: Ctx, fk: FKResult, nodeId: string): Joint[] {
  const memberId = ctx.incident.get(nodeId)?.[0];
  let body = memberId ? ctx.bodyOfMember.get(memberId) : undefined;
  const jointById = new Map<string, Joint>();
  for (const edges of ctx.adj.values()) for (const e of edges) jointById.set(e.joint.id, e.joint);
  const out: Joint[] = [];
  while (body) {
    const jid = fk.parentJointOf.get(body);
    if (!jid) break;
    const jt = jointById.get(jid);
    if (!jt) break;
    out.push(jt);
    // move to the other (parent) body of this joint
    const frame = fk.frames.get(jid);
    const child = frame?.child;
    const ba = ctx.bodyOfMember.get(jt.receiver);
    const bb = ctx.bodyOfMember.get(jt.mover);
    body = child === ba ? bb : ba;
  }
  return out;
}

const CCD_ITERS = 24;
const CCD_TOL = 1e-7;

function cloneState(s: JointState): JointState {
  return { angles: { ...s.angles }, orient: { ...s.orient } };
}

/** Cyclic-coordinate-descent IK: adjust the path joints so `nodeId` reaches
 * `target` (as near as the mechanism allows). A wrapped joint rotates about its
 * fixed axis; a free joint rotates in whatever direction best closes the gap.
 * Rigid transforms mean every member length is preserved exactly regardless of
 * convergence. */
function ccd(
  ctx: Ctx,
  state: JointState,
  nodeId: string,
  target: Vec3,
): { state: JointState; converged: boolean } {
  const s = cloneState(state);
  let converged = false;
  for (let it = 0; it < CCD_ITERS; it++) {
    const fk = runFK(ctx, s);
    if (length(sub(worldNodePos(nodeId, ctx, fk.T), target)) < CCD_TOL) {
      converged = true;
      break;
    }
    for (const jt of pathJoints(ctx, fk, nodeId)) {
      const cur = runFK(ctx, s);
      const frame = cur.frames.get(jt.id);
      if (!frame) continue;
      const e = worldNodePos(nodeId, ctx, cur.T);
      const { point } = frame;
      const eV = sub(e, point);
      const tV = sub(target, point);
      if (jt.mode === 'wrapped' && frame.axis) {
        const axis = frame.axis;
        const eP = sub(eV, scale(axis, dot(eV, axis)));
        const tP = sub(tV, scale(axis, dot(tV, axis)));
        if (length(eP) < 1e-9 || length(tP) < 1e-9) continue;
        const delta = Math.atan2(dot(cross(eP, tP), axis), dot(eP, tP));
        s.angles[jt.id] = clampAngle((s.angles[jt.id] ?? jt.angleRad ?? 0) + delta, jt.limits);
      } else if (jt.mode === 'free') {
        if (length(eV) < 1e-9 || length(tV) < 1e-9) continue;
        const en = normalize(eV);
        const tn = normalize(tV);
        const axis = cross(en, tn);
        if (length(axis) < 1e-9) continue;
        const ang = Math.atan2(length(axis), dot(en, tn));
        const dq = axisAngleQuat(axis, ang);
        const curOrient = s.orient[jt.id] ?? jt.orientation ?? IDENTITY_Q;
        s.orient[jt.id] = mulQ(dq, curOrient); // compose in the world frame
      }
    }
  }
  return { state: s, converged };
}

export interface PoseResult {
  nodePositions: Record<string, Vec3>;
  memberTransforms: Record<string, { position: Vec3; quaternion: Quaternion }>;
  pivotAngles: Record<string, number>;
  jointOrientations: Record<string, Quaternion>;
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

/** Loop-closure solver. The spanning-tree WRAPPED joints (`treeIds`) are the
 * free variables; a damped Gauss-Newton (Levenberg-Marquardt) drives:
 *   • closure — each loop-closing joint's node must agree between its two bodies
 *     (this is what keeps every member length exact around the loop),
 *   • regularization — tree angles stay near their slider targets,
 *   • drag (optional) — the dragged node reaches its target.
 * Free tree joints hold their stored orientation constant through the solve.
 * Returns resolved angles for ALL wrapped joints + the final FK. */
function solveLoops(
  ctx: Ctx,
  design: Design,
  state: JointState,
  loopJoints: Joint[],
  treeIds: string[],
  dragTarget?: { nodeId: string; position: Vec3 },
): { angles: Record<string, number>; converged: boolean; fk: FKResult } {
  const targets = state.angles;
  const n = treeIds.length;
  const W_CLOSE = 40;
  const W_REG = 0.05;
  const W_DRAG = 2;
  const x = treeIds.map((id) => targets[id] ?? 0);

  const stateFrom = (xv: number[]): JointState => {
    const angles = { ...targets };
    treeIds.forEach((id, i) => {
      angles[id] = xv[i]!;
    });
    return { angles, orient: state.orient };
  };
  const residual = (xv: number[]): number[] => {
    const fk = runFK(ctx, stateFrom(xv));
    const r: number[] = [];
    for (const p of loopJoints) {
      const nd = ctx.nodePos.get(p.nodeId);
      const ba = ctx.bodyOfMember.get(p.receiver);
      const bb = ctx.bodyOfMember.get(p.mover);
      const ta = ba ? fk.T.get(ba) : undefined;
      const tb = bb ? fk.T.get(bb) : undefined;
      if (!nd || !ta || !tb) continue;
      const na = applyT(ta, nd);
      const nb = applyT(tb, nd);
      r.push((na.x - nb.x) * W_CLOSE, (na.y - nb.y) * W_CLOSE, (na.z - nb.z) * W_CLOSE);
    }
    for (let i = 0; i < n; i++) r.push((xv[i]! - (targets[treeIds[i]!] ?? 0)) * W_REG);
    // wrapped loop joints have no tree variable — pull their *measured* angle
    // toward the slider target so driving ANY wrapped pivot moves the loop
    for (const p of loopJoints) {
      if (p.mode !== 'wrapped') continue;
      const ba = ctx.bodyOfMember.get(p.receiver);
      const bb = ctx.bodyOfMember.get(p.mover);
      const ta = ba ? fk.T.get(ba) : undefined;
      const tb = bb ? fk.T.get(bb) : undefined;
      if (!ta || !tb) continue;
      const cur = relAngleAbout(
        ta,
        tb,
        normalize(rotate(ta.r, ctx.jointAxis.get(p.id) ?? { x: 1, y: 0, z: 0 })),
      );
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
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xj = x.slice();
      xj[j]! += EPS;
      const rj = residual(xj);
      for (let i = 0; i < m; i++) J[i]![j] = (rj[i]! - r[i]!) / EPS;
    }
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

  const fk = runFK(ctx, stateFrom(x));
  const angles: Record<string, number> = {};
  const treeSet = new Set(treeIds);
  for (const p of design.joints) {
    if (p.mode !== 'wrapped') continue;
    if (treeSet.has(p.id)) {
      angles[p.id] = x[treeIds.indexOf(p.id)]!;
      continue;
    }
    const ba = ctx.bodyOfMember.get(p.receiver);
    const bb = ctx.bodyOfMember.get(p.mover);
    const ta = ba ? fk.T.get(ba) : undefined;
    const tb = bb ? fk.T.get(bb) : undefined;
    angles[p.id] =
      ta && tb
        ? relAngleAbout(
            ta,
            tb,
            normalize(rotate(ta.r, ctx.jointAxis.get(p.id) ?? { x: 1, y: 0, z: 0 })),
          )
        : (targets[p.id] ?? 0);
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

/** Grübler mobility per connected component. Each wrapped joint contributes 1
 * DOF, each free (ball) joint 3. A component whose joints are ALL wrapped with
 * parallel axes is a PLANAR mechanism (its loops are over-counted by the spatial
 * formula), so it uses 3·(b−1) − 2·j; otherwise the spatial general Grübler
 * 6·(b−1) − Σ(6−fᵢ). Over-constrained means the (correct) DOF is negative. */
function mobility(ctx: Ctx): { dof: number; overConstrained: boolean } {
  const seen = new Set<string>();
  let dof = 0;
  let over = false;
  for (const start of ctx.bodies) {
    if (seen.has(start)) continue;
    let b = 0;
    const stack = [start];
    seen.add(start);
    const jointSeen = new Set<string>();
    const wrappedAxes: Vec3[] = [];
    let sumF = 0;
    let allWrapped = true;
    while (stack.length) {
      const cur = stack.pop()!;
      b++;
      for (const e of ctx.adj.get(cur) ?? []) {
        if (!jointSeen.has(e.joint.id)) {
          jointSeen.add(e.joint.id);
          if (e.joint.mode === 'wrapped') {
            wrappedAxes.push(ctx.jointAxis.get(e.joint.id) ?? { x: 1, y: 0, z: 0 });
            sumF += 1;
          } else {
            allWrapped = false;
            sumF += 3;
          }
        }
        if (!seen.has(e.other)) {
          seen.add(e.other);
          stack.push(e.other);
        }
      }
    }
    const j = jointSeen.size;
    const planar = allWrapped && allParallel(wrappedAxes);
    const compDof = planar ? 3 * (b - 1) - 2 * j : 6 * (b - 1) - (6 * j - sumF);
    dof += compDof;
    if (compDof < 0) over = true;
  }
  return { dof, overConstrained: over };
}

export function solvePose(
  design: Design,
  inputs: {
    pivotAngles: Record<string, number>;
    jointOrientations?: Record<string, Quaternion>;
    dragTarget?: { nodeId: string; position: Vec3 };
  },
): PoseResult {
  const ctx = buildCtx(design);
  const orient: Record<string, Quaternion> = {};
  for (const j of design.joints) {
    if (j.mode === 'free') {
      orient[j.id] = inputs.jointOrientations?.[j.id] ?? j.orientation ?? IDENTITY_Q;
    }
  }
  const state: JointState = { angles: { ...inputs.pivotAngles }, orient };

  // which joints are spanning-tree edges vs loop-closing (back) edges
  const refFK = runFK(ctx, state);
  const treeWrapped = [...refFK.frames.entries()]
    .filter(([, f]) => f.mode === 'wrapped')
    .map(([id]) => id);
  const loopJoints = design.joints.filter((p) => {
    if (p.mode === 'anchor') return false;
    const ba = ctx.bodyOfMember.get(p.receiver);
    const bb = ctx.bodyOfMember.get(p.mover);
    return !!ba && !!bb && ba !== bb && !refFK.frames.has(p.id);
  });

  let angles = { ...state.angles };
  let orientOut = { ...orient };
  let converged = true;
  let fk: FKResult;
  if (loopJoints.length > 0) {
    // closed loops: run loop closure over wrapped tree joints so every member
    // length stays exact and driving one pivot pushes the others
    const r = solveLoops(ctx, design, state, loopJoints, treeWrapped, inputs.dragTarget);
    angles = r.angles;
    converged = r.converged;
    fk = r.fk;
  } else {
    if (inputs.dragTarget) {
      const r = ccd(ctx, state, inputs.dragTarget.nodeId, inputs.dragTarget.position);
      angles = r.state.angles;
      orientOut = r.state.orient;
      converged = r.converged;
    }
    fk = runFK(ctx, { angles, orient: orientOut });
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
  const resolvedOrient: Record<string, Quaternion> = {};
  for (const jt of design.joints) {
    if (jt.mode === 'wrapped') {
      resolvedAngles[jt.id] = clampAngle(angles[jt.id] ?? jt.angleRad ?? 0, jt.limits);
    } else if (jt.mode === 'free') {
      resolvedOrient[jt.id] = orientOut[jt.id] ?? jt.orientation ?? IDENTITY_Q;
    }
  }
  const mob = mobility(ctx);
  return {
    nodePositions,
    memberTransforms,
    pivotAngles: resolvedAngles,
    jointOrientations: resolvedOrient,
    mobilityDof: mob.dof,
    overConstrained: mob.overConstrained,
    converged,
  };
}
