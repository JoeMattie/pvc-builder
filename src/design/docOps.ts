// Pure document operations over a Design (planfile §2, mirroring riglab's
// docOps): every editing action is a pure `Design → Design` transform, applied
// through appStore.updateCurrent so undo/autosave stay centralized. No
// three.js / UI types here.
import { add, cross, dot, length, normalize, sub } from '../geometry/math3';
import type { Design, Member, Node, NominalSize, Pivot, Vec3, Wrap } from '../schema';
import { makeId } from './ids';

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
 * (Phase 1 nodes exist only as member endpoints). Pivots that referenced the
 * deleted member, or a node it orphaned, are removed too (no dangling pivots).
 * Wraps whose through pipe was deleted, or whose branch node was orphaned, are
 * removed as well. */
export function deleteMember(design: Design, memberId: string): Design {
  const members = design.members.filter((m) => m.id !== memberId);
  const referenced = new Set<string>();
  for (const m of members) {
    referenced.add(m.nodeA);
    referenced.add(m.nodeB);
  }
  const pivots = design.pivots.filter(
    (p) => p.memberA !== memberId && p.memberB !== memberId && referenced.has(p.nodeId),
  );
  const memberIds = new Set(members.map((m) => m.id));
  const wraps = design.wraps.filter(
    (w) => memberIds.has(w.throughMember) && referenced.has(w.branchNode),
  );
  return {
    ...design,
    members,
    nodes: design.nodes.filter((n) => referenced.has(n.id)),
    pivots,
    wraps,
  };
}

// ── heat-wrapped tees (planfile §4 fabrication) ─────────────────────────────

/** All wraps whose branch end is `nodeId`. */
export function wrapsAtNode(design: Design, nodeId: string): Wrap[] {
  return design.wraps.filter((w) => w.branchNode === nodeId);
}

/** Add a heat-wrapped tee: the branch ending at `branchNode` wraps around the
 * intact straight `throughMember`. Rigid (screwed) by default. Ignored (returns
 * `wrapId: null`) if the members/node don't exist, the through member isn't
 * straight, or that branch node already wraps something. */
export function addWrap(
  design: Design,
  throughMember: string,
  branchNode: string,
  rigid = true,
  id: string = makeId('wr'),
): { design: Design; wrapId: string | null } {
  const through = memberById(design, throughMember);
  if (through?.kind !== 'straight') return { design, wrapId: null };
  if (!nodeById(design, branchNode)) return { design, wrapId: null };
  if (design.wraps.some((w) => w.branchNode === branchNode)) return { design, wrapId: null };
  const wrap: Wrap = { id, throughMember, branchNode, rigid };
  return { design: { ...design, wraps: [...design.wraps, wrap] }, wrapId: id };
}

/** Toggle a wrap between rigid (screwed) and a natural pivot. */
export function setWrapRigid(design: Design, wrapId: string, rigid: boolean): Design {
  return {
    ...design,
    wraps: design.wraps.map((w) => (w.id === wrapId ? { ...w, rigid } : w)),
  };
}

export function removeWrap(design: Design, wrapId: string): Design {
  return { ...design, wraps: design.wraps.filter((w) => w.id !== wrapId) };
}

/** Reset every pivot to its rest angle (0). */
export function resetPivots(design: Design): Design {
  return { ...design, pivots: design.pivots.map((p) => ({ ...p, angleRad: 0 })) };
}

/** A node's incident members (both straight and formed). */
export function incidentMembers(design: Design, nodeId: string): Member[] {
  return design.members.filter((m) => m.nodeA === nodeId || m.nodeB === nodeId);
}

/** Whether a node can become a pivot: exactly two members meet and it isn't
 * already a pivot. */
export function canPivot(design: Design, nodeId: string): boolean {
  return (
    incidentMembers(design, nodeId).length === 2 && !design.pivots.some((p) => p.nodeId === nodeId)
  );
}

/** Add a heat-formed revolute pivot at a 2-member node. The default axis is the
 * joint-plane normal (so rotating opens/closes the bend); for a straight
 * (collinear) run it falls back to a horizontal axis across the run. Returns
 * the design unchanged with `pivotId: null` if the node can't pivot. */
export function addPivot(
  design: Design,
  nodeId: string,
  id: string = makeId('pv'),
): { design: Design; pivotId: string | null } {
  if (!canPivot(design, nodeId)) return { design, pivotId: null };
  const node = nodeById(design, nodeId);
  if (!node) return { design, pivotId: null };
  const [mA, mB] = incidentMembers(design, nodeId) as [Member, Member];
  const otherA = mA.nodeA === nodeId ? mA.nodeB : mA.nodeA;
  const otherB = mB.nodeA === nodeId ? mB.nodeB : mB.nodeA;
  const pA = nodeById(design, otherA)?.position;
  const pB = nodeById(design, otherB)?.position;
  if (!pA || !pB) return { design, pivotId: null };
  const dirA = normalize(sub(pA, node.position));
  const dirB = normalize(sub(pB, node.position));
  let axis = cross(dirA, dirB);
  if (length(axis) < 1e-6) {
    axis = cross(dirA, { x: 0, y: 1, z: 0 });
    if (length(axis) < 1e-6) axis = { x: 1, y: 0, z: 0 };
  }
  const pivot: Pivot = {
    id,
    nodeId,
    memberA: mA.id,
    memberB: mB.id,
    axis: normalize(axis),
    angleRad: 0,
  };
  return { design: { ...design, pivots: [...design.pivots, pivot] }, pivotId: id };
}

export function removePivot(design: Design, pivotId: string): Design {
  return { ...design, pivots: design.pivots.filter((p) => p.id !== pivotId) };
}

export function setPivotAngle(design: Design, pivotId: string, angleRad: number): Design {
  return {
    ...design,
    pivots: design.pivots.map((p) => (p.id === pivotId ? { ...p, angleRad } : p)),
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
