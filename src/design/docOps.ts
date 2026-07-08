// Pure document operations over a Design (planfile §2, mirroring riglab's
// docOps): every editing action is a pure `Design → Design` transform, applied
// through appStore.updateCurrent so undo/autosave stay centralized. No
// three.js / UI types here.
import { add, cross, dot, length, normalize, sub } from '../geometry/math3';
import type {
  Design,
  Joint,
  JointMode,
  Measurement,
  MeasurementEnd,
  Member,
  Node,
  NominalSize,
  Quaternion,
  Vec3,
} from '../schema';
import { makeId } from './ids';
import { closestPointOnSegment } from './snapping';

/** An existing node at (or very near) `pos`, for reusing a junction instead of
 * duplicating it. */
export function findNodeAt(design: Design, pos: Vec3, tol = 1e-6): string | undefined {
  return design.nodes.find((n) => length(sub(n.position, pos)) < tol)?.id;
}

/** Fast node lookup for a design. */
export function nodeMap(design: Design): Map<string, Node> {
  return new Map(design.nodes.map((n) => [n.id, n]));
}

export function nodeById(design: Design, id: string): Node | undefined {
  return design.nodes.find((n) => n.id === id);
}

export function memberById(design: Design, id: string): Member | undefined {
  return design.members.find((m) => m.id === id);
}

/** The two world endpoints of a straight member, or null if a node is
 * missing. */
export function memberEndpoints(design: Design, member: Member): { a: Vec3; b: Vec3 } | null {
  const a = nodeById(design, member.nodeA)?.position;
  const b = nodeById(design, member.nodeB)?.position;
  return a && b ? { a, b } : null;
}

/** Centre-to-centre length of a straight member (SI metres). */
export function memberLengthM(design: Design, member: Member): number {
  const e = memberEndpoints(design, member);
  return e ? length(sub(e.b, e.a)) : 0;
}

/** Add a bare node at `position`. */
export function addNode(
  design: Design,
  position: Vec3,
  id: string = makeId('n'),
): { design: Design; nodeId: string } {
  return {
    design: { ...design, nodes: [...design.nodes, { id, position }] },
    nodeId: id,
  };
}

/** Add a straight member between two existing nodes. */
export function addMember(
  design: Design,
  nodeA: string,
  nodeB: string,
  size: NominalSize,
  id: string = makeId('m'),
): { design: Design; memberId: string } {
  const member: Member = { id, kind: 'straight', nodeA, nodeB, size };
  return {
    design: { ...design, members: [...design.members, member] },
    memberId: id,
  };
}

/** Add a heat-bent (formed) member A→controlPoints→B. Endpoints reuse an
 * existing node when one sits at that position (so a formed pipe can start/end
 * on a junction), else new nodes are created. */
export function addFormedMember(
  design: Design,
  aPos: Vec3,
  bPos: Vec3,
  controlPoints: Vec3[],
  size: NominalSize,
  filletRadiiM?: number[],
): { design: Design; memberId: string } {
  let d = design;
  let nodeA = findNodeAt(d, aPos);
  if (!nodeA) {
    const r = addNode(d, aPos);
    d = r.design;
    nodeA = r.nodeId;
  }
  let nodeB = findNodeAt(d, bPos);
  if (!nodeB) {
    const r = addNode(d, bPos);
    d = r.design;
    nodeB = r.nodeId;
  }
  const id = makeId('m');
  const member: Member = { id, kind: 'formed', nodeA, nodeB, controlPoints, size, filletRadiiM };
  return { design: { ...d, members: [...d.members, member] }, memberId: id };
}

/** Start a pipe path: place the first node (the pen-down point). */
export function startPath(
  design: Design,
  position: Vec3,
  id: string = makeId('n'),
): { design: Design; nodeId: string } {
  return addNode(design, position, id);
}

/** Extend a path: add a node at `toPosition` and a straight member from
 * `fromNodeId` to it. Returns the new node id (the next path cursor). */
export function appendPipe(
  design: Design,
  fromNodeId: string,
  toPosition: Vec3,
  size: NominalSize,
): { design: Design; nodeId: string; memberId: string } {
  const added = addNode(design, toPosition);
  const joined = addMember(added.design, fromNodeId, added.nodeId, size);
  return { design: joined.design, nodeId: added.nodeId, memberId: joined.memberId };
}

/** Connect a path to an existing node (closing a loop / joining a junction)
 * without creating a new node. */
export function connectPipe(
  design: Design,
  fromNodeId: string,
  toNodeId: string,
  size: NominalSize,
): { design: Design; memberId: string } {
  return addMember(design, fromNodeId, toNodeId, size);
}

/** Move a node (drag). Members incident to it follow. */
export function setNodePosition(design: Design, nodeId: string, position: Vec3): Design {
  return {
    ...design,
    nodes: design.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
  };
}

/** Change a member's nominal size (the right-click size switcher). Reducing
 * tees are DERIVED from the receiver/mover sizes (see `resolveFittings`), so no
 * joint record changes — the unions re-resolve automatically. */
export function setMemberSize(design: Design, memberId: string, size: NominalSize): Design {
  return {
    ...design,
    members: design.members.map((m) => (m.id === memberId ? { ...m, size } : m)),
  };
}

/** Break the union at one member's endpoint: give `memberId`'s end at `nodeId`
 * its own new (coincident) node so it can move independently of the other pipes
 * that shared that junction, and drop any joint tied to `memberId` there. Returns
 * the new node id (or the original `nodeId` unchanged when there was nothing to
 * detach from — a lone end). This is the Ctrl-drag "break the union" op. */
export function detachMemberEnd(
  design: Design,
  memberId: string,
  nodeId: string,
): { design: Design; nodeId: string } {
  const m = memberById(design, memberId);
  if (!m || (m.nodeA !== nodeId && m.nodeB !== nodeId)) return { design, nodeId };
  // only meaningful if the node is actually shared with another member
  if (incidentMembers(design, nodeId).length <= 1) return { design, nodeId };
  const node = nodeById(design, nodeId);
  if (!node) return { design, nodeId };
  const newId = makeId('n');
  const newNode: Node = { id: newId, position: { ...node.position } };
  const members = design.members.map((mm) =>
    mm.id === memberId
      ? {
          ...mm,
          nodeA: mm.nodeA === nodeId ? newId : mm.nodeA,
          nodeB: mm.nodeB === nodeId ? newId : mm.nodeB,
        }
      : mm,
  );
  const joints = design.joints.filter(
    (j) => !(j.nodeId === nodeId && (j.receiver === memberId || j.mover === memberId)),
  );
  return {
    design: { ...design, nodes: [...design.nodes, newNode], members, joints },
    nodeId: newId,
  };
}

/** Weld node `fromId` into `intoId`: rewire every member/joint that referenced
 * `fromId` to `intoId`, drop `fromId`, discard any member that collapsed to
 * zero length, prune joints whose members/nodes no longer exist, and de-dupe the
 * joints now sharing the node. This is what dropping one pipe end exactly onto
 * another does — the two ends become ONE junction (so you never get two
 * overlapping joints at coincident-but-separate nodes). */
export function weldNodes(design: Design, fromId: string, intoId: string): Design {
  if (fromId === intoId) return design;
  const remap = (id: string) => (id === fromId ? intoId : id);
  const members = design.members
    .map((m) => ({ ...m, nodeA: remap(m.nodeA), nodeB: remap(m.nodeB) }))
    .filter((m) => m.nodeA !== m.nodeB); // a member spanning the welded pair collapses
  const memberIds = new Set(members.map((m) => m.id));
  const nodes = design.nodes.filter((n) => n.id !== fromId);
  const joints = design.joints
    .map((j) => ({ ...j, nodeId: remap(j.nodeId) }))
    .filter((j) => memberIds.has(j.receiver) && memberIds.has(j.mover));
  return dedupeJoints({ ...design, nodes, members, joints });
}

/** Translate a whole member by `delta` (the move tool): both endpoint nodes —
 * and, for a formed pipe, its control points — shift together, so lengths and
 * bends are preserved. Shared endpoints move any incident members with them. */
export function translateMember(design: Design, memberId: string, delta: Vec3): Design {
  const m = memberById(design, memberId);
  if (!m) return design;
  const move = (p: Vec3): Vec3 => add(p, delta);
  const nodes = design.nodes.map((n) =>
    n.id === m.nodeA || n.id === m.nodeB ? { ...n, position: move(n.position) } : n,
  );
  const members =
    m.kind === 'formed'
      ? design.members.map((mm) =>
          mm.id === memberId && mm.kind === 'formed'
            ? { ...mm, controlPoints: mm.controlPoints.map(move) }
            : mm,
        )
      : design.members;
  return { ...design, nodes, members };
}

/** Rotate a point `p` about `pivot` around unit axis `k` by `angle` (Rodrigues). */
function rotateAroundAxis(p: Vec3, pivot: Vec3, k: Vec3, angle: number): Vec3 {
  const v = sub(p, pivot);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kxv = cross(k, v);
  const kv = dot(k, v) * (1 - c);
  return add(pivot, {
    x: v.x * c + kxv.x * s + k.x * kv,
    y: v.y * c + kxv.y * s + k.y * kv,
    z: v.z * c + kxv.z * s + k.z * kv,
  });
}

/** Rotate a whole member by `angleRad` about `pivot` around world `axis` (the
 * rotate tool): both endpoint nodes — and a formed pipe's control points —
 * turn together, so lengths and bends are preserved. */
export function rotateMember(
  design: Design,
  memberId: string,
  axis: Vec3,
  angleRad: number,
  pivot: Vec3,
): Design {
  const m = memberById(design, memberId);
  if (!m || length(axis) < 1e-9) return design;
  const k = normalize(axis);
  const rot = (p: Vec3): Vec3 => rotateAroundAxis(p, pivot, k, angleRad);
  const nodes = design.nodes.map((n) =>
    n.id === m.nodeA || n.id === m.nodeB ? { ...n, position: rot(n.position) } : n,
  );
  const members =
    m.kind === 'formed'
      ? design.members.map((mm) =>
          mm.id === memberId && mm.kind === 'formed'
            ? { ...mm, controlPoints: mm.controlPoints.map(rot) }
            : mm,
        )
      : design.members;
  return { ...design, nodes, members };
}

/** Set a straight member's exact length by moving nodeB along the current
 * A→B axis (nodeA stays put). A degenerate (zero-length) member extends along
 * +X so the edit is still well-defined. */
export function setMemberLengthM(design: Design, memberId: string, lengthM: number): Design {
  const member = memberById(design, memberId);
  if (member?.kind !== 'straight') return design; // formed length is derived
  const e = memberEndpoints(design, member);
  if (!e) return design;
  const d = sub(e.b, e.a);
  const dir = length(d) < 1e-9 ? { x: 1, y: 0, z: 0 } : normalize(d);
  const newB = {
    x: e.a.x + dir.x * lengthM,
    y: e.a.y + dir.y * lengthM,
    z: e.a.z + dir.z * lengthM,
  };
  return setNodePosition(design, member.nodeB, newB);
}

/** Split a straight member at `pos`: replace A–B with A–N and N–B (same size,
 * new ids) where N is a new node at `pos`. Returns the new node id so a branch
 * can connect there → the node now has two collinear run members + the branch =
 * a tee (`resolveFittings` classifies it automatically). Formed members are not
 * split (returns the design unchanged with `nodeId: null`); the caller falls
 * back to a free point. */
export function splitMemberAt(
  design: Design,
  memberId: string,
  pos: Vec3,
): { design: Design; nodeId: string | null } {
  const member = memberById(design, memberId);
  if (member?.kind !== 'straight') return { design, nodeId: null };
  // reuse an existing node if the split point lands on one (e.g. an endpoint) —
  // splitting there would make a zero-length stub
  const existing = findNodeAt(design, pos, 1e-6);
  if (existing) return { design, nodeId: existing };

  const added = addNode(design, pos);
  const nId = added.nodeId;
  const a = addMember(added.design, member.nodeA, nId, member.size);
  const b = addMember(a.design, nId, member.nodeB, member.size);
  return {
    design: { ...b.design, members: b.design.members.filter((m) => m.id !== memberId) },
    nodeId: nId,
  };
}

/** Delete a member and prune any node it leaves with no incident members
 * (Phase 1 nodes exist only as member endpoints). Joints that referenced the
 * deleted member (as receiver or mover), or a node it orphaned, are removed too
 * (no dangling joints). */
export function deleteMember(design: Design, memberId: string): Design {
  const members = design.members.filter((m) => m.id !== memberId);
  const referenced = new Set<string>();
  for (const m of members) {
    referenced.add(m.nodeA);
    referenced.add(m.nodeB);
  }
  const memberIds = new Set(members.map((m) => m.id));
  const joints = design.joints.filter(
    (j) => memberIds.has(j.receiver) && memberIds.has(j.mover) && referenced.has(j.nodeId),
  );
  return {
    ...design,
    members,
    nodes: design.nodes.filter((n) => referenced.has(n.id)),
    joints,
  };
}

// ── measurements: persistent tape-measure annotations (schema v6) ───────────

/** World position of one measurement end: a pinned node's live position, or a
 * free stored point. */
export function measurementEndPos(design: Design, end: MeasurementEnd): Vec3 | undefined {
  return 'nodeId' in end ? nodeById(design, end.nodeId)?.position : end.position;
}

/** The (horizontal) unit direction the dimension line is offset along — the
 * perpendicular to the measured axis. Shared by the offset action and the
 * renderer so the number and the drawing agree. Falls back to +X when the axis
 * is vertical. */
export function measurePerp(a: Vec3, b: Vec3): Vec3 {
  const axis = sub(b, a);
  if (length(axis) < 1e-9) return { x: 1, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  const p = cross(normalize(axis), up);
  return length(p) < 1e-6 ? { x: 1, y: 0, z: 0 } : normalize(p);
}

/** The centre-to-centre length a measurement reports (SI metres). */
export function measurementLengthM(design: Design, m: Measurement): number {
  const a = measurementEndPos(design, m.a);
  const b = measurementEndPos(design, m.b);
  return a && b ? length(sub(b, a)) : 0;
}

/** Add a persistent tape measure between two ends. */
export function addMeasurement(
  design: Design,
  a: MeasurementEnd,
  b: MeasurementEnd,
  offsetM = 0,
  id: string = makeId('ms'),
): { design: Design; measurementId: string } {
  const measurement: Measurement = { id, a, b, offsetM };
  return {
    design: { ...design, measurements: [...design.measurements, measurement] },
    measurementId: id,
  };
}

/** Set a measurement's perpendicular dimension-line offset. */
export function setMeasurementOffset(design: Design, id: string, offsetM: number): Design {
  return {
    ...design,
    measurements: design.measurements.map((m) => (m.id === id ? { ...m, offsetM } : m)),
  };
}

/** Remove a measurement. */
export function removeMeasurement(design: Design, id: string): Design {
  return { ...design, measurements: design.measurements.filter((m) => m.id !== id) };
}

// ── joints: unified pipe connections (planfile §4/§5) ───────────────────────

/** A node's incident members (both straight and formed). */
export function incidentMembers(design: Design, nodeId: string): Member[] {
  return design.members.filter((m) => m.nodeA === nodeId || m.nodeB === nodeId);
}

/** Length of a straight member (0 for formed / missing endpoints). */
function straightLength(design: Design, m: Member): number {
  const ends = memberEndpoints(design, m);
  return ends ? length(sub(ends.b, ends.a)) : 0;
}

/** Unit direction of a straight member leaving `nodeId` toward its far end
 * (null for a formed member or a missing node). Used to derive a wrapped
 * pivot's axis (the receiver's own direction). */
export function memberDirFromNode(design: Design, member: Member, nodeId: string): Vec3 | null {
  if (member.kind !== 'straight') return null;
  const far = member.nodeA === nodeId ? member.nodeB : member.nodeA;
  const here = nodeById(design, nodeId)?.position;
  const there = nodeById(design, far)?.position;
  if (!here || !there) return null;
  const d = sub(there, here);
  return length(d) < 1e-9 ? null : normalize(d);
}

/** A straight member whose span passes through `nodeId`'s position without
 * having it as an endpoint — the intact run an on-body branch wraps around. */
export function throughMemberAt(design: Design, nodeId: string): Member | undefined {
  const p = nodeById(design, nodeId)?.position;
  if (!p) return undefined;
  for (const m of design.members) {
    if (m.kind !== 'straight') continue;
    if (m.nodeA === nodeId || m.nodeB === nodeId) continue;
    const ends = memberEndpoints(design, m);
    if (ends && length(sub(closestPointOnSegment(p, ends.a, ends.b), p)) < 1e-6) return m;
  }
  return undefined;
}

/** Every joint whose connection point is `nodeId`. */
export function jointsAtNode(design: Design, nodeId: string): Joint[] {
  return design.joints.filter((j) => j.nodeId === nodeId);
}

/** The joint (if any) whose `mover` is `moverId` at `nodeId`. */
export function jointForMover(design: Design, nodeId: string, moverId: string): Joint | undefined {
  return design.joints.find((j) => j.nodeId === nodeId && j.mover === moverId);
}

export function jointById(design: Design, jointId: string): Joint | undefined {
  return design.joints.find((j) => j.id === jointId);
}

/** The connection choices available for member `moverId` where it meets the
 * structure at `nodeId` — the seam both the right-click menu and the scripted
 * hook read to build/gate the anchor / wrapped / free options. */
export interface JoinContext {
  /** the joint record already present for (nodeId, moverId), if any */
  existing: Joint | undefined;
  /** mover's end lies on the receiver's intact span (a branch/tee on a body) */
  onBody: boolean;
  /** the default receiver: the through run, or the longest other pipe */
  receiver: string | undefined;
  /** every candidate receiver (other straight members at the node, or the run) */
  candidates: string[];
  /** a free ball joint applies: two eye-boltable ends butt, or a branch
   * ball-joints to a saddle eye bolt on the run body (on-body) */
  canFree: boolean;
  /** a wrapped pivot / on-body anchor applies (a receiver pipe exists) */
  canWrap: boolean;
}

export function joinContext(design: Design, nodeId: string, moverId: string): JoinContext {
  const existing = jointForMover(design, nodeId, moverId);
  const others = incidentMembers(design, nodeId).filter(
    (m) => m.id !== moverId && m.kind === 'straight',
  );
  if (others.length > 0) {
    // end-to-end (or a tee): other pipe ends share this node
    const receiver =
      (existing && !existing.onBody ? existing.receiver : undefined) ??
      [...others].sort((a, b) => straightLength(design, b) - straightLength(design, a))[0]?.id;
    return {
      existing,
      onBody: false,
      receiver,
      candidates: others.map((m) => m.id),
      canFree: true,
      canWrap: !!receiver,
    };
  }
  // on-body: the mover's end sits on an intact run's span
  const through = existing
    ? memberById(design, existing.receiver)
    : throughMemberAt(design, nodeId);
  return {
    existing,
    onBody: true,
    receiver: through?.id,
    candidates: through ? [through.id] : [],
    // a branch can ball-joint to a saddle eye bolt clamped on the run body
    canFree: !!through,
    canWrap: !!through,
  };
}

export function removeJoint(design: Design, jointId: string): Design {
  return { ...design, joints: design.joints.filter((j) => j.id !== jointId) };
}

/** Set member `moverId`'s connection mode at `nodeId`, creating / updating /
 * removing the joint record. `receiverId` overrides the auto-picked receiver
 * (must be one of `joinContext.candidates`). A plain end-to-end anchor is the
 * DEFAULT (a rigid coupling/elbow) and carries no record. Returns the design
 * unchanged if `mode` doesn't apply to the geometry. */
export function setJoinMode(
  design: Design,
  nodeId: string,
  moverId: string,
  mode: JointMode,
  receiverId?: string,
): Design {
  const ctx = joinContext(design, nodeId, moverId);
  if (mode === 'free' && !ctx.canFree) return design;
  if ((mode === 'wrapped' || mode === 'anchor') && !ctx.canWrap) return design;
  const receiver = receiverId && ctx.candidates.includes(receiverId) ? receiverId : ctx.receiver;
  if (!receiver) return design;

  // Find the record for this connection, matching the UNORDERED member pair at
  // the node — so a right-click on the OTHER pipe of the same joint (which sees
  // `mover`/`receiver` swapped) edits it in place rather than appending a second,
  // swapped record for the same pair.
  const existing =
    ctx.existing ??
    design.joints.find(
      (j) =>
        j.nodeId === nodeId &&
        ((j.receiver === receiver && j.mover === moverId) ||
          (j.receiver === moverId && j.mover === receiver)),
    );

  // an end-to-end anchor IS the default rigid coupling → drop any record
  if (mode === 'anchor' && !ctx.onBody) {
    return existing ? removeJoint(design, existing.id) : design;
  }

  const next: Joint = {
    id: existing?.id ?? makeId('jt'),
    nodeId,
    receiver,
    mover: moverId,
    onBody: ctx.onBody,
    mode,
  };
  // preserve articulation state across a mode/receiver change where meaningful
  if (mode === 'wrapped' && existing?.receiver === receiver) {
    if (existing.angleRad !== undefined) next.angleRad = existing.angleRad;
    if (existing.limits) next.limits = existing.limits;
  } else if (mode === 'free' && existing?.orientation) {
    next.orientation = existing.orientation;
  }
  return { ...design, joints: [...design.joints.filter((j) => j.id !== next.id), next] };
}

/** Create an on-body joint at draw time: the branch ending at `branchNode` wraps
 * the intact straight `receiver`. Rigid/screwed (`anchor`) by default. Ignored
 * (returns `jointId: null`) if the geometry is invalid, `mode` is `free`, or
 * that branch already carries a joint. */
export function addBodyJoint(
  design: Design,
  receiver: string,
  branchNode: string,
  mode: Exclude<JointMode, 'free'> = 'anchor',
  id: string = makeId('jt'),
): { design: Design; jointId: string | null } {
  const run = memberById(design, receiver);
  if (run?.kind !== 'straight') return { design, jointId: null };
  if (!nodeById(design, branchNode)) return { design, jointId: null };
  const branch = incidentMembers(design, branchNode).find((m) => m.id !== receiver);
  if (!branch) return { design, jointId: null };
  // refuse a duplicate for this branch: an existing record with the same mover,
  // OR one describing the same UNORDERED pair with receiver/mover swapped
  if (
    design.joints.some(
      (j) =>
        j.nodeId === branchNode &&
        (j.mover === branch.id || (j.receiver === branch.id && j.mover === receiver)),
    )
  )
    return { design, jointId: null };
  const joint: Joint = { id, nodeId: branchNode, receiver, mover: branch.id, onBody: true, mode };
  return { design: { ...design, joints: [...design.joints, joint] }, jointId: id };
}

/** Collapse duplicate joints at a node that describe the SAME physical
 * connection: two records whose UNORDERED member pair is equal — either an exact
 * duplicate, or the swapped case `{receiver:A, mover:B}` + `{receiver:B, mover:A}`
 * that a right-click on each of the two pipes could otherwise create. Each such
 * group collapses to ONE joint: a non-`anchor` mode (a deliberate wrapped/free
 * pivot) wins over a default `anchor`; among equally-preferred candidates the
 * LAST in array order (most recently set) is kept, with its own fields intact.
 * Joints not part of any duplicate group pass through unchanged and in original
 * relative order. Pure; never mutates the input. */
export function dedupeJoints(design: Design): Design {
  const groupKey = (j: Joint): string => {
    const [a, b] = j.receiver < j.mover ? [j.receiver, j.mover] : [j.mover, j.receiver];
    return `${j.nodeId}|${a}|${b}`;
  };
  const groups = new Map<string, Joint[]>();
  for (const j of design.joints) {
    const k = groupKey(j);
    const g = groups.get(k);
    if (g) g.push(j);
    else groups.set(k, [j]);
  }
  const keptIds = new Set<string>();
  let changed = false;
  for (const g of groups.values()) {
    if (g.length === 1) {
      keptIds.add(g[0]!.id);
      continue;
    }
    changed = true;
    // prefer a non-anchor pivot; among candidates keep the LAST (most recent)
    const preferred = g.filter((j) => j.mode !== 'anchor');
    const pool = preferred.length ? preferred : g;
    keptIds.add(pool[pool.length - 1]!.id);
  }
  if (!changed) return design;
  return { ...design, joints: design.joints.filter((j) => keptIds.has(j.id)) };
}

/** Repair missing on-body unions: any pipe endpoint that sits exactly on another
 * straight member's span (a tee/branch) but carries no joint becomes a rigid
 * (anchor) on-body union — the same union drawing forms. Without it such a branch
 * reads as an unresolved red overlap instead of a tee. Idempotent; used when
 * importing a design (older files, or ones drawn before the union was created).
 * Runs `dedupeJoints` last, so this is the single choke both the live reconcile
 * and the import path pass through to collapse swapped/duplicate joint pairs. */
export function healBodyJoints(design: Design): Design {
  let d = design;
  for (const m of design.members) {
    if (m.kind !== 'straight') continue;
    for (const nodeId of [m.nodeA, m.nodeB]) {
      // only a clean branch END (one incident member) with no existing union
      if (incidentMembers(d, nodeId).length !== 1) continue;
      if (d.joints.some((j) => j.nodeId === nodeId && j.mover === m.id)) continue;
      const run = throughMemberAt(d, nodeId);
      if (run) d = addBodyJoint(d, run.id, nodeId, 'anchor').design;
    }
  }
  return dedupeJoints(d);
}

/** How close a branch endpoint must stay to its receiver's centre-line to keep
 * an on-body union alive after an edit (drags snap exactly onto the run, so this
 * only forgives sub-0.1 mm float drift). */
const ON_BODY_KEEP_TOL_M = 1e-4;

/** Keep on-body unions in sync with geometry after a live edit (a drag or a
 * length change): drop any union whose branch endpoint has moved off its
 * receiver's span, then (re)create a rigid union for any endpoint that now sits
 * on a run — so connecting and disconnecting happen immediately, mid-gesture. A
 * union whose branch still rides the same receiver keeps its chosen mode
 * (wrapped / free). Idempotent. */
export function reconcileBodyJoints(design: Design): Design {
  const stillAttached = (j: Joint): boolean => {
    if (!j.onBody) return true; // end-to-end unions aren't span-based
    const recv = memberById(design, j.receiver);
    const p = nodeById(design, j.nodeId)?.position;
    if (recv?.kind !== 'straight' || !p) return false;
    // a branch that became an endpoint of the receiver is a shared node, not a
    // body union
    if (recv.nodeA === j.nodeId || recv.nodeB === j.nodeId) return false;
    const e = memberEndpoints(design, recv);
    if (!e) return false;
    return length(sub(closestPointOnSegment(p, e.a, e.b), p)) < ON_BODY_KEEP_TOL_M;
  };
  const kept = design.joints.filter(stillAttached);
  const pruned = kept.length === design.joints.length ? design : { ...design, joints: kept };
  return healBodyJoints(pruned);
}

/** Swap which pipe is the receiver vs the mover (end-to-end joints only). */
export function swapReceiver(design: Design, jointId: string): Design {
  return {
    ...design,
    joints: design.joints.map((j) =>
      j.id === jointId && !j.onBody ? { ...j, receiver: j.mover, mover: j.receiver } : j,
    ),
  };
}

export function setJointAngle(design: Design, jointId: string, angleRad: number): Design {
  return {
    ...design,
    joints: design.joints.map((j) => (j.id === jointId ? { ...j, angleRad } : j)),
  };
}

export function setJointOrientation(design: Design, jointId: string, q: Quaternion): Design {
  return {
    ...design,
    joints: design.joints.map((j) => (j.id === jointId ? { ...j, orientation: q } : j)),
  };
}

/** Reset every pivot joint to its rest pose (wrapped → angle 0, free → identity). */
export function resetJoints(design: Design): Design {
  return {
    ...design,
    joints: design.joints.map((j) => {
      if (j.mode === 'wrapped') return { ...j, angleRad: 0 };
      if (j.mode === 'free') return { ...j, orientation: undefined };
      return j;
    }),
  };
}

/** Degree (incident member count) of every node, for joint rendering. */
export function nodeDegrees(design: Design): Map<string, number> {
  const deg = new Map<string, number>();
  for (const m of design.members) {
    deg.set(m.nodeA, (deg.get(m.nodeA) ?? 0) + 1);
    deg.set(m.nodeB, (deg.get(m.nodeB) ?? 0) + 1);
  }
  return deg;
}
