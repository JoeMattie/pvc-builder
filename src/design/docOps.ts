// Pure document operations over a Design (planfile §2, mirroring riglab's
// docOps): every editing action is a pure `Design → Design` transform, applied
// through appStore.updateCurrent so undo/autosave stay centralized. No
// three.js / UI types here.
import { length, normalize, sub } from '../geometry/math3';
import type { Design, Member, Node, NominalSize, Vec3 } from '../schema';
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

/** Delete a member and prune any node it leaves with no incident members
 * (Phase 1 nodes exist only as member endpoints). */
export function deleteMember(design: Design, memberId: string): Design {
  const members = design.members.filter((m) => m.id !== memberId);
  const referenced = new Set<string>();
  for (const m of members) {
    referenced.add(m.nodeA);
    referenced.add(m.nodeB);
  }
  return {
    ...design,
    members,
    nodes: design.nodes.filter((n) => referenced.has(n.id)),
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
