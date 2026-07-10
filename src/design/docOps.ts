// Pure document operations over a Design (planfile §2, mirroring riglab's
// docOps): every editing action is a pure `Design → Design` transform, applied
// through appStore.updateCurrent so undo/autosave stay centralized. No
// three.js / UI types here.
import { add, cross, dot, length, normalize, scale, sub } from '../geometry/math3';
import { developedLengthM } from '../geometry/pipe';
import {
  type Attachment,
  type Design,
  type Elastic,
  type Group,
  type Joint,
  type JointMode,
  type Measurement,
  type MeasurementEnd,
  type Member,
  type Node,
  type NominalSize,
  pipeSpec,
  type Quaternion,
  type Vec3,
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

/** Bend a straight member into a heat-formed curve: pull the point at parameter
 * `t` (0..1 along the pipe) by `perpOffset` (its component perpendicular to the
 * pipe axis is used). With `lockEndAngles`, the bend starts a short distance in
 * from each end so the end tangents stay axial (a smooth transition).
 * `filletRadiusM` is the heat-form bend radius to record (the caller derives it
 * from the pipe size + min-radius).
 *
 * TWO modes:
 *  - default (GROW): endpoints stay fixed, so the developed length grows as you
 *    pull; the perpendicular pull is clamped to the pipe length.
 *  - LENGTH-LOCK (`opts.lengthLock`): the developed (cut) length is held to
 *    `lengthM`, so bending draws the far end IN instead of adding pipe. nodeA
 *    stays put; nodeB slides along the frozen `axisDir` to whatever chord makes
 *    the developed centre-line equal `lengthM` (found by bisection, which also
 *    handles the lock-end-angle lead-ins). The reference (`axisDir`,`lengthM`)
 *    must be captured at gesture start by the caller so it doesn't drift as
 *    nodeB moves each frame. */
export function bendMember(
  design: Design,
  memberId: string,
  t: number,
  perpOffset: Vec3,
  filletRadiusM: number,
  opts?: { lockEndAngles?: boolean; lengthLock?: { axisDir: Vec3; lengthM: number } },
): Design {
  const m = memberById(design, memberId);
  // works on a straight member OR an already-bent one (a live drag re-bends each
  // frame from the fixed endpoints), so the bend recomputes from the chord
  if (!m) return design;
  const a = nodeById(design, m.nodeA)?.position;
  const b = nodeById(design, m.nodeB)?.position;
  if (!a || !b) return design;
  const tc = Math.max(0, Math.min(1, t));

  const asFormed = (controlPoints: Vec3[]): Member => ({
    id: m.id,
    kind: 'formed',
    nodeA: m.nodeA,
    nodeB: m.nodeB,
    controlPoints,
    size: m.size,
    filletRadiiM: controlPoints.map(() => filletRadiusM),
  });
  const replace = (d: Design, member: Member): Design => ({
    ...d,
    members: d.members.map((mm) => (mm.id === memberId ? member : mm)),
  });

  if (opts?.lengthLock) {
    const L = opts.lengthLock.lengthM;
    if (L < 1e-6) return design;
    const u = normalize(opts.lengthLock.axisDir);
    // perpendicular component of the pull, capped so a length-conserving chord
    // always exists (going out and back can't exceed the material length)
    let perpV = sub(perpOffset, scale(u, dot(perpOffset, u)));
    let pm = length(perpV);
    const cap = L * 0.49;
    if (pm > cap) {
      perpV = scale(perpV, cap / pm);
      pm = cap;
    }
    // no perpendicular pull → straighten the member back to length L along u
    if (pm < 1e-9) {
      const straight = setNodePosition(design, m.nodeB, add(a, scale(u, L)));
      return replace(straight, {
        id: m.id,
        kind: 'straight',
        nodeA: m.nodeA,
        nodeB: m.nodeB,
        size: m.size,
      });
    }
    const phat = scale(perpV, 1 / pm);
    // build the bend for a given chord length (nodeB at a + u·cLen); `len` is the
    // DEVELOPED (filleted) centre-line — the actual cut length — so locking holds
    // what the BOM reports, not just the sharp polyline
    const build = (cLen: number) => {
      const nb = add(a, scale(u, cLen));
      const control = add(add(a, scale(u, tc * cLen)), scale(phat, pm));
      const cps = opts.lockEndAngles
        ? [
            add(a, scale(u, Math.min(cLen * 0.2, cLen * tc, cLen * (1 - tc)))),
            control,
            sub(nb, scale(u, Math.min(cLen * 0.2, cLen * tc, cLen * (1 - tc)))),
          ]
        : [control];
      const len = developedLengthM(
        [a, ...cps, nb],
        cps.map(() => filletRadiusM),
      );
      return { nb, cps, len };
    };
    // developed length is largest at the full chord (cLen = L) and shrinks as the
    // chord closes. If even the full chord can't reach L (a gentle pull whose
    // fillet rounding alone drops it below L), keep the ends put — don't grow.
    let hi = L;
    if (build(L).len <= L) {
      const { nb, cps } = build(L);
      return replace(setNodePosition(design, m.nodeB, nb), asFormed(cps));
    }
    let lo = 1e-4;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (build(mid).len > L) hi = mid;
      else lo = mid;
    }
    const { nb, cps } = build((lo + hi) / 2);
    return replace(setNodePosition(design, m.nodeB, nb), asFormed(cps));
  }

  // GROW: endpoints fixed, developed length grows
  const axis = sub(b, a);
  const len = length(axis);
  if (len < 1e-6) return design;
  const u = scale(axis, 1 / len);
  let perp = sub(perpOffset, scale(u, dot(perpOffset, u)));
  const pmag = length(perp);
  if (pmag > len) perp = scale(perp, len / pmag);
  const control = add(add(a, scale(u, tc * len)), perp);
  const controlPoints = opts?.lockEndAngles
    ? [
        add(a, scale(u, Math.min(len * 0.2, len * tc, len * (1 - tc)))),
        control,
        sub(b, scale(u, Math.min(len * 0.2, len * tc, len * (1 - tc)))),
      ]
    : [control];
  return replace(design, asFormed(controlPoints));
}

/** Move one control point of a formed (curve) member — the Bend tool's tweak
 * handles. No-op for a straight member or an out-of-range index. */
export function moveControlPoint(
  design: Design,
  memberId: string,
  index: number,
  position: Vec3,
): Design {
  return {
    ...design,
    members: design.members.map((m) => {
      if (m.id !== memberId || m.kind !== 'formed') return m;
      if (index < 0 || index >= m.controlPoints.length) return m;
      return {
        ...m,
        controlPoints: m.controlPoints.map((cp, i) => (i === index ? position : cp)),
      };
    }),
  };
}

/** Add a control point to a formed pipe at `point`, inserted into whichever
 * segment of its polyline (nodeA → controls → nodeB) the point is nearest — so
 * clicking the tube adds a bend handle where you clicked. No-op for a straight
 * member. */
export function addControlPointAt(design: Design, memberId: string, point: Vec3): Design {
  const m = memberById(design, memberId);
  if (m?.kind !== 'formed') return design;
  const a = nodeById(design, m.nodeA)?.position;
  const b = nodeById(design, m.nodeB)?.position;
  if (!a || !b) return design;
  const pts = [a, ...m.controlPoints, b];
  let bestI = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = length(sub(point, closestPointOnSegment(point, pts[i]!, pts[i + 1]!)));
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  // controlPoints index for a click in segment bestI is bestI (controlPoints[k]
  // is polyline point k+1), so the new point lands between pts[bestI] and pts[bestI+1]
  const fillets = m.filletRadiiM ?? [];
  const fillet = fillets[0] ?? 0;
  return {
    ...design,
    members: design.members.map((mm) =>
      mm.id === memberId
        ? {
            ...m,
            controlPoints: [
              ...m.controlPoints.slice(0, bestI),
              point,
              ...m.controlPoints.slice(bestI),
            ],
            filletRadiiM: [...fillets.slice(0, bestI), fillet, ...fillets.slice(bestI)],
          }
        : mm,
    ),
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

/** Translate SEVERAL members together as ONE rigid body: the UNION of their
 * endpoint nodes (and any formed control points) shifts by `delta` exactly
 * ONCE. This is NOT the same as folding `translateMember` over each id — a node
 * shared by two selected members would then move twice (2·delta), skewing the
 * group. Ungrouped nodes incident to the moved members are left untouched. */
export function translateMembers(design: Design, memberIds: string[], delta: Vec3): Design {
  if (!memberIds.length) return design;
  const ids = new Set(memberIds);
  const move = (p: Vec3): Vec3 => add(p, delta);
  const nodeIds = new Set<string>();
  for (const m of design.members) {
    if (!ids.has(m.id)) continue;
    nodeIds.add(m.nodeA);
    nodeIds.add(m.nodeB);
  }
  const nodes = design.nodes.map((n) =>
    nodeIds.has(n.id) ? { ...n, position: move(n.position) } : n,
  );
  const members = design.members.map((m) =>
    ids.has(m.id) && m.kind === 'formed' ? { ...m, controlPoints: m.controlPoints.map(move) } : m,
  );
  return { ...design, nodes, members };
}

/** Rotate SEVERAL members together as ONE rigid body: the UNION of their
 * endpoint nodes (and any formed control points) turns about `pivot` around
 * world `axis` exactly ONCE, so a node shared by two selected members isn't
 * turned twice (which skews the group). See `translateMembers` for the same
 * shared-node rationale. */
export function rotateMembers(
  design: Design,
  memberIds: string[],
  axis: Vec3,
  angleRad: number,
  pivot: Vec3,
): Design {
  if (!memberIds.length || length(axis) < 1e-9) return design;
  const ids = new Set(memberIds);
  const k = normalize(axis);
  const rot = (p: Vec3): Vec3 => rotateAroundAxis(p, pivot, k, angleRad);
  const nodeIds = new Set<string>();
  for (const m of design.members) {
    if (!ids.has(m.id)) continue;
    nodeIds.add(m.nodeA);
    nodeIds.add(m.nodeB);
  }
  const nodes = design.nodes.map((n) =>
    nodeIds.has(n.id) ? { ...n, position: rot(n.position) } : n,
  );
  const members = design.members.map((m) =>
    ids.has(m.id) && m.kind === 'formed' ? { ...m, controlPoints: m.controlPoints.map(rot) } : m,
  );
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

/** Split a FORMED (heat-bent) member at the point on its polyline closest to
 * `pos`: replace it with TWO members sharing a node AT `pos`, distributing the
 * control points + `filletRadiiM` to the halves in polyline order (a half left
 * with no control points becomes a plain straight member). Unlike
 * `splitMemberAt`, an existing node within 1e-6 of `pos` is REUSED as the
 * shared node and the member is still split — the solver cuts formed pipes at
 * an existing junction this way. Joints referencing the member follow the half
 * that carries their node; group membership transfers to both halves.
 *
 * A cut landing ON a bend corner (within `CORNER_CUT_EPS_M` of a control point)
 * is CLEAN: the corner becomes the junction node itself, each half keeps its
 * own side's interior controls, and the fold survives as the halves' meeting
 * angle — two arcs wrapped + screwed together at their apexes is exactly the
 * rigid-custom fabrication.
 *
 * REFUSED (`nodeId: null`, design unchanged) rather than corrupting when:
 * `pos` falls inside a bend's fold window but OFF the corner (within the
 * corner's fillet radius, or ~2 ODs for a sharp 0-fillet crease whose
 * Catmull-Rom hug points occupy that span — cutting there would strand fold
 * geometry and deform the bend), the cut would leave a sub-centimetre stub, an
 * elastic attachment rides the member (its `{memberId, t}` param has no safe
 * remap), or a joint references the member away from its endpoints. `pos` at
 * an endpoint returns that node with no split. */
export const CORNER_CUT_EPS_M = 0.002;

export function splitFormedAt(
  design: Design,
  memberId: string,
  pos: Vec3,
): { design: Design; nodeId: string | null } {
  const m = memberById(design, memberId);
  if (m?.kind !== 'formed') return { design, nodeId: null };
  const aPos = nodeById(design, m.nodeA)?.position;
  const bPos = nodeById(design, m.nodeB)?.position;
  if (!aPos || !bPos) return { design, nodeId: null };
  // splitting at (or next to) an end is no split — reuse the end node
  if (length(sub(pos, aPos)) < 1e-6) return { design, nodeId: m.nodeA };
  if (length(sub(pos, bPos)) < 1e-6) return { design, nodeId: m.nodeB };
  // an elastic's {memberId, t} attachment can't be remapped safely — refuse
  const rides = (att: Attachment) => 'memberId' in att && att.memberId === memberId;
  if (design.elastics.some((e) => rides(e.a) || rides(e.b))) return { design, nodeId: null };
  // joints may reference the member only at its endpoints (movers / end-to-end
  // records); anything else can't follow a half — refuse
  if (
    design.joints.some(
      (j) =>
        (j.receiver === memberId || j.mover === memberId) &&
        j.nodeId !== m.nodeA &&
        j.nodeId !== m.nodeB,
    )
  )
    return { design, nodeId: null };

  /** Build the two halves at `nodeId`, giving controls[0..c1) to half 1 and
   * controls[c2..] to half 2, and remap joints/groups off the original id. */
  const finishSplit = (
    d0: Design,
    cutPos: Vec3,
    c1: number,
    c2: number,
  ): { design: Design; nodeId: string } => {
    const existing = findNodeAt(d0, cutPos, 1e-6);
    let d = d0;
    let nodeId: string;
    if (existing) {
      nodeId = existing;
    } else {
      const r = addNode(d, cutPos);
      d = r.design;
      nodeId = r.nodeId;
    }
    const fillets = m.controlPoints.map((_, i) => m.filletRadiiM?.[i] ?? 0);
    const half = (nodeA: string, nodeB: string, controls: Vec3[], f: number[]): Member =>
      controls.length
        ? {
            id: makeId('m'),
            kind: 'formed',
            nodeA,
            nodeB,
            controlPoints: controls,
            size: m.size,
            filletRadiiM: f,
          }
        : { id: makeId('m'), kind: 'straight', nodeA, nodeB, size: m.size };
    const h1 = half(m.nodeA, nodeId, m.controlPoints.slice(0, c1), fillets.slice(0, c1));
    const h2 = half(nodeId, m.nodeB, m.controlPoints.slice(c2), fillets.slice(c2));
    const members = [...d.members.filter((mm) => mm.id !== memberId), h1, h2];
    const followHalf = (id: string, jNode: string) =>
      id !== memberId ? id : jNode === m.nodeA ? h1.id : h2.id;
    const joints = d.joints.map((j) =>
      j.receiver === memberId || j.mover === memberId
        ? {
            ...j,
            receiver: followHalf(j.receiver, j.nodeId),
            mover: followHalf(j.mover, j.nodeId),
          }
        : j,
    );
    const groups = d.groups.map((g) =>
      g.memberIds.includes(memberId)
        ? { ...g, memberIds: [...g.memberIds.filter((x) => x !== memberId), h1.id, h2.id] }
        : g,
    );
    return { design: { ...d, members, joints, groups }, nodeId };
  };

  // a cut AT a corner control point: the corner becomes the junction node and
  // is CONSUMED (its fillet dropped); each half keeps its own side's controls
  const cornerIdx = m.controlPoints.findIndex((c) => length(sub(pos, c)) < CORNER_CUT_EPS_M);
  if (cornerIdx >= 0) {
    const corner = m.controlPoints[cornerIdx]!;
    if (length(sub(corner, aPos)) < 0.01 || length(sub(corner, bPos)) < 0.01)
      return { design, nodeId: null };
    return finishSplit(design, corner, cornerIdx, cornerIdx + 1);
  }

  // keep clear of every bend corner's fold window, and of the ends (no stubs)
  const clear = (i: number) => Math.max(m.filletRadiiM?.[i] ?? 0, 2 * pipeSpec(m.size).odM);
  for (let i = 0; i < m.controlPoints.length; i++) {
    if (length(sub(pos, m.controlPoints[i]!)) < clear(i)) return { design, nodeId: null };
  }
  if (length(sub(pos, aPos)) < 0.01 || length(sub(pos, bPos)) < 0.01)
    return { design, nodeId: null };

  // the polyline leg carrying the closest point decides which controls go to
  // which half
  const pts = [aPos, ...m.controlPoints, bPos];
  let cut = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const dd = length(sub(closestPointOnSegment(pos, pts[i]!, pts[i + 1]!), pos));
    if (dd < bestD) {
      bestD = dd;
      cut = i;
    }
  }
  return finishSplit(design, pos, cut, cut);
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
  // prune elastic bands whose attachment references a deleted member or an
  // orphaned node — a band can't hang on geometry that no longer exists
  const attachAlive = (att: Attachment): boolean =>
    'nodeId' in att ? referenced.has(att.nodeId) : memberIds.has(att.memberId);
  const elastics = design.elastics.filter((e) => attachAlive(e.a) && attachAlive(e.b));
  return pruneGroups({
    ...design,
    members,
    nodes: design.nodes.filter((n) => referenced.has(n.id)),
    joints,
    elastics,
  });
}

// ── copy / paste: extract a self-contained fragment, then re-insert with fresh
// ids (offset so the paste clears the original) ──────────────────────────────

/** A copyable fragment: members + the nodes they use + any joints wholly between
 * them. Ids are the ORIGINAL ids (remapped on paste). */
export interface Subgraph {
  nodes: Node[];
  members: Member[];
  joints: Joint[];
}

/** Pull the selected members (+ their nodes + joints wholly among them) out as a
 * copyable fragment (deep-cloned so it's independent of the live document). */
export function extractSubgraph(design: Design, memberIds: string[]): Subgraph {
  const idSet = new Set(memberIds);
  const members = design.members.filter((m) => idSet.has(m.id));
  const nodeIds = new Set<string>();
  for (const m of members) {
    nodeIds.add(m.nodeA);
    nodeIds.add(m.nodeB);
  }
  const nodes = design.nodes.filter((n) => nodeIds.has(n.id));
  const joints = design.joints.filter(
    (j) => idSet.has(j.receiver) && idSet.has(j.mover) && nodeIds.has(j.nodeId),
  );
  return {
    nodes: nodes.map((n) => structuredClone(n)),
    members: members.map((m) => structuredClone(m)),
    joints: joints.map((j) => structuredClone(j)),
  };
}

/** Bounding-box extent (max − min per axis) of a subgraph's node positions. */
export function subgraphExtent(sub: Subgraph): Vec3 {
  const first = sub.nodes[0];
  if (!first) return { x: 0, y: 0, z: 0 };
  const lo = { ...first.position };
  const hi = { ...first.position };
  for (const n of sub.nodes) {
    lo.x = Math.min(lo.x, n.position.x);
    lo.y = Math.min(lo.y, n.position.y);
    lo.z = Math.min(lo.z, n.position.z);
    hi.x = Math.max(hi.x, n.position.x);
    hi.y = Math.max(hi.y, n.position.y);
    hi.z = Math.max(hi.z, n.position.z);
  }
  return { x: hi.x - lo.x, y: hi.y - lo.y, z: hi.z - lo.z };
}

/** Paste `sub` into `design`, translated by `offset`, with fresh ids throughout
 * (nodes, members, joints, and formed control points all shifted). Returns the
 * new member ids so the caller can select the pasted copy. */
export function pasteSubgraph(
  design: Design,
  sub: Subgraph,
  offset: Vec3,
): { design: Design; memberIds: string[]; nodeIds: string[] } {
  const nodeIdMap = new Map<string, string>();
  const newNodes: Node[] = sub.nodes.map((n) => {
    const id = makeId('n');
    nodeIdMap.set(n.id, id);
    return { id, position: add(n.position, offset) };
  });
  const memberIdMap = new Map<string, string>();
  const newMembers: Member[] = sub.members.map((m) => {
    const id = makeId('m');
    memberIdMap.set(m.id, id);
    const nodeA = nodeIdMap.get(m.nodeA) ?? m.nodeA;
    const nodeB = nodeIdMap.get(m.nodeB) ?? m.nodeB;
    return m.kind === 'formed'
      ? { ...m, id, nodeA, nodeB, controlPoints: m.controlPoints.map((p) => add(p, offset)) }
      : { ...m, id, nodeA, nodeB };
  });
  const newJoints: Joint[] = [];
  for (const j of sub.joints) {
    const nodeId = nodeIdMap.get(j.nodeId);
    const receiver = memberIdMap.get(j.receiver);
    const mover = memberIdMap.get(j.mover);
    if (nodeId && receiver && mover)
      newJoints.push({ ...j, id: makeId('jt'), nodeId, receiver, mover });
  }
  return {
    design: {
      ...design,
      nodes: [...design.nodes, ...newNodes],
      members: [...design.members, ...newMembers],
      joints: [...design.joints, ...newJoints],
    },
    memberIds: newMembers.map((m) => m.id),
    nodeIds: newNodes.map((n) => n.id),
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

// ── elastics: spring bands between two attachment points (schema v8) ─────────

/** World position of an elastic attachment: a pinned node's live position, or
 * the point at fraction `t` along a straight member (lerp nodeA→nodeB).
 * Returns undefined if the referenced node/member is missing. */
export function attachmentPos(design: Design, att: Attachment): Vec3 | undefined {
  if ('nodeId' in att) return nodeById(design, att.nodeId)?.position;
  const m = memberById(design, att.memberId);
  if (!m) return undefined;
  const e = memberEndpoints(design, m);
  if (!e) return undefined;
  const t = Math.max(0, Math.min(1, att.t));
  return add(e.a, scale(sub(e.b, e.a), t));
}

/** The current span of an elastic band (SI metres); 0 if either end is
 * unresolved. */
export function elasticLengthM(design: Design, e: Elastic): number {
  const a = attachmentPos(design, e.a);
  const b = attachmentPos(design, e.b);
  return a && b ? length(sub(b, a)) : 0;
}

/** Add an elastic band between two attachment points. */
export function addElastic(
  design: Design,
  a: Attachment,
  b: Attachment,
  restLengthM: number,
  stiffnessNPerM: number,
  id: string = makeId('el'),
): { design: Design; elasticId: string } {
  const elastic: Elastic = { id, a, b, restLengthM, stiffnessNPerM };
  return {
    design: { ...design, elastics: [...design.elastics, elastic] },
    elasticId: id,
  };
}

/** Remove an elastic band. */
export function removeElastic(design: Design, id: string): Design {
  return { ...design, elastics: design.elastics.filter((e) => e.id !== id) };
}

/** Set an elastic band's stiffness (the tension slider). */
export function setElasticStiffness(design: Design, id: string, stiffnessNPerM: number): Design {
  return {
    ...design,
    elastics: design.elastics.map((e) => (e.id === id ? { ...e, stiffnessNPerM } : e)),
  };
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

/** Convert a connection to a MANUFACTURED joint: rotate the `moverId` pipe about
 * `nodeId` so its approach angle snaps to the nearest standard off-the-shelf
 * fitting (a 90° or 45° elbow, or a straight coupling), and drop any pivot/wrap
 * record — so `resolveFittings` then classifies + draws a real socket fitting.
 * The standard is chosen by the angle between the two OUTGOING directions:
 * 90° (elbow), 135° (45° elbow), or 180° (coupling). Straight movers only. */
export function makeManufacturedJoint(design: Design, nodeId: string, moverId: string): Design {
  const ctx = joinContext(design, nodeId, moverId);
  const receiverId = ctx.receiver;
  if (!receiverId) return design;
  const recv = memberById(design, receiverId);
  const mover = memberById(design, moverId);
  if (recv?.kind !== 'straight' || mover?.kind !== 'straight') return design;
  const recvDir = memberDirFromNode(design, recv, nodeId);
  const moverDir = memberDirFromNode(design, mover, nodeId);
  const nodePos = nodeById(design, nodeId)?.position;
  if (!recvDir || !moverDir || !nodePos) return design;
  const cur = Math.acos(Math.max(-1, Math.min(1, dot(recvDir, moverDir))));
  const axis = cross(recvDir, moverDir);
  if (length(axis) < 1e-6) return design; // already collinear — nothing to snap
  const n = normalize(axis);
  // nearest standard angle between the outgoing directions
  const STANDARDS = [Math.PI / 2, (3 * Math.PI) / 4, Math.PI];
  const target = STANDARDS.reduce((best, s) =>
    Math.abs(s - cur) < Math.abs(best - cur) ? s : best,
  );
  const far = mover.nodeA === nodeId ? mover.nodeB : mover.nodeA;
  const farPos = nodeById(design, far)?.position;
  if (!farPos) return design;
  const rotated = rotateAroundAxis(farPos, nodePos, n, target - cur);
  // move the mover's far end to the snapped angle, drop the pivot record →
  // resolveFittings now infers the manufactured elbow/coupling
  const moved = setNodePosition(design, far, rotated);
  const existing = jointForMover(moved, nodeId, moverId);
  return existing ? removeJoint(moved, existing.id) : moved;
}

/** Turn the connection point `nodeId` into a shared FREE (ball) hub: every
 * straight pipe that ends there pivots freely about the one point. Stored as
 * PAIRWISE free records (kinematically a shared ball — every pipe end is held
 * coincident at the node yet free to orient), with the longest incident pipe as
 * the common receiver and one free joint per OTHER incident pipe. Any other
 * joints at the node are dropped; an existing free orientation for a mover is
 * preserved. No-op if fewer than two straight pipes end at the node (an on-body
 * branch, whose run only passes through, uses the pairwise `setJoinMode('free')`
 * path instead). */
export function makeFreeHub(design: Design, nodeId: string): Design {
  const incident = incidentMembers(design, nodeId).filter((m) => m.kind === 'straight');
  if (incident.length < 2) return design;
  const receiver = [...incident].sort(
    (a, b) => straightLength(design, b) - straightLength(design, a),
  )[0]!;
  const others = design.joints.filter((j) => j.nodeId !== nodeId);
  const hub: Joint[] = [];
  for (const m of incident) {
    if (m.id === receiver.id) continue;
    const prev = jointForMover(design, nodeId, m.id);
    const joint: Joint = {
      id: prev?.id ?? makeId('jt'),
      nodeId,
      receiver: receiver.id,
      mover: m.id,
      onBody: false,
      mode: 'free',
    };
    if (prev?.mode === 'free' && prev.orientation) joint.orientation = prev.orientation;
    hub.push(joint);
  }
  return { ...design, joints: [...others, ...hub] };
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
 * the intact straight `receiver`. Rigid/screwed (`anchor`) by default. The mover
 * is the first member incident to `branchNode` that doesn't already carry a
 * joint there — so a further pipe joined at the same junction (a multi-way
 * heat-wrap, e.g. from `solveIntersections`) records its union on a free mover.
 * Ignored (returns `jointId: null`) if the geometry is invalid, `mode` is
 * `free`, `receiver` is already tied into a joint at that node, or no free
 * mover remains. */
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
  const atNode = design.joints.filter((j) => j.nodeId === branchNode);
  // refuse a duplicate: the receiver already participates in a joint at this
  // junction (as either side), so the union it describes is already recorded
  if (atNode.some((j) => j.receiver === receiver || j.mover === receiver))
    return { design, jointId: null };
  const branch = incidentMembers(design, branchNode).find(
    (m) => m.id !== receiver && !atNode.some((j) => j.mover === m.id),
  );
  if (!branch) return { design, jointId: null };
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
  // any member's clean end — straight OR formed (curve) — that lands on a straight
  // run's span gets an on-body union, so curves join runs just like regular pipes.
  // The RUN (receiver) must be straight (throughMemberAt enforces that); the branch
  // (mover) may be either.
  for (const m of design.members) {
    for (const nodeId of [m.nodeA, m.nodeB]) {
      // only a clean branch END (one incident member) with no existing union
      if (incidentMembers(d, nodeId).length !== 1) continue;
      if (d.joints.some((j) => j.nodeId === nodeId && j.mover === m.id)) continue;
      const run = throughMemberAt(d, nodeId);
      // don't auto-union across a group boundary — a branch snapped onto a grouped
      // run (from outside) defers its union until the group is dissolved
      if (run && memberGroupKey(d, m.id) === memberGroupKey(d, run.id))
        d = addBodyJoint(d, run.id, nodeId, 'anchor').design;
    }
  }
  return dedupeJoints(d);
}

/** How close a branch endpoint must stay to its receiver's centre-line to keep
 * an on-body union alive after an edit (drags snap exactly onto the run, so this
 * only forgives sub-0.1 mm float drift). Exported so `solveIntersections` can
 * guarantee the junctions it creates survive the next reconcile. */
export const ON_BODY_KEEP_TOL_M = 1e-4;

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

// ── groups (schema v7): named sets of members that select/move/copy as a unit
// and defer unions across their boundary until dissolved ────────────────────

/** The group containing `memberId`, or undefined. A member is in ≤1 group. */
export function groupOfMember(design: Design, memberId: string): Group | undefined {
  return design.groups.find((g) => g.memberIds.includes(memberId));
}

/** The id of the group containing `memberId`, or null (ungrouped). */
export function memberGroupKey(design: Design, memberId: string): string | null {
  return groupOfMember(design, memberId)?.id ?? null;
}

/** The group key of a node — the group of any member incident to it (null =
 * ungrouped). Two nodes with different keys must not auto-union. */
export function nodeGroupKey(design: Design, nodeId: string): string | null {
  for (const m of design.members) {
    if (m.nodeA === nodeId || m.nodeB === nodeId) {
      const k = memberGroupKey(design, m.id);
      if (k) return k;
    }
  }
  return null;
}

/** Every member id in a group (empty if the group is gone). */
export function groupMemberIds(design: Design, groupId: string): string[] {
  return design.groups.find((g) => g.id === groupId)?.memberIds ?? [];
}

/** A palette of distinct, muted hues auto-assigned to groups that carry no
 * explicit colour (schema v10). Ten well-separated casts. */
export const GROUP_PALETTE = [
  '#e0794d',
  '#4d9de0',
  '#7bc86c',
  '#c86cbe',
  '#d9b64d',
  '#4dd0c8',
  '#e05d6f',
  '#8c6ce0',
  '#5fb37e',
  '#d98cae',
] as const;

/** The effective colour cast of a group: its stored `color`, or a deterministic
 * palette pick hashed from the group id (stable across reorders/reopens). */
export function groupColorOf(design: Design, groupId: string): string {
  const g = design.groups.find((x) => x.id === groupId);
  if (g?.color) return g.color;
  let h = 0;
  for (let i = 0; i < groupId.length; i++) h = (h * 31 + groupId.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[h % GROUP_PALETTE.length]!;
}

/** Set (or clear, with undefined) a group's explicit colour cast. */
export function setGroupColor(design: Design, groupId: string, color: string | undefined): Design {
  const idx = design.groups.findIndex((g) => g.id === groupId);
  if (idx < 0) return design;
  const groups = [...design.groups];
  groups[idx] = { ...groups[idx]!, color };
  return { ...design, groups };
}

/** Group the given members into ONE new group. Members are first removed from
 * any existing group (a member belongs to ≤1 group); groups left empty are
 * dropped. Returns the new group id. */
export function groupMembers(
  design: Design,
  memberIds: string[],
  id: string = makeId('g'),
): { design: Design; groupId: string } {
  const ids = [...new Set(memberIds)].filter((mid) => memberById(design, mid));
  if (!ids.length) return { design, groupId: id };
  const idSet = new Set(ids);
  const groups = design.groups
    .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => !idSet.has(m)) }))
    .filter((g) => g.memberIds.length > 0);
  groups.push({ id, memberIds: ids });
  return { design: { ...design, groups }, groupId: id };
}

/** Add members to an existing group (e.g. pipes drawn while inside it). No-op if
 * the group is gone or every member is already in it. */
export function addMembersToGroup(design: Design, groupId: string, memberIds: string[]): Design {
  const idx = design.groups.findIndex((g) => g.id === groupId);
  if (idx < 0) return design;
  const g = design.groups[idx]!;
  const add = memberIds.filter((m) => !g.memberIds.includes(m) && memberById(design, m));
  if (!add.length) return design;
  const groups = [...design.groups];
  groups[idx] = { ...g, memberIds: [...g.memberIds, ...add] };
  return { ...design, groups };
}

/** Remove group ids from every group + drop any that become empty (used after a
 * member delete, and internally). */
export function pruneGroups(design: Design): Design {
  const memberIds = new Set(design.members.map((m) => m.id));
  const groups = design.groups
    .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => memberIds.has(m)) }))
    .filter((g) => g.memberIds.length > 0);
  return groups.length === design.groups.length &&
    groups.every((g, i) => g.memberIds.length === design.groups[i]?.memberIds.length)
    ? design
    : { ...design, groups };
}

/** Weld every pair of coincident nodes allowed to merge (same group context),
 * then heal on-body unions. Used to AUTO-SOLVE deferred unions when a group is
 * dissolved: geometry that was snapped-but-not-unioned across the boundary now
 * connects. */
export function weldCoincidentNodes(design: Design, tol = 1e-4): Design {
  let d = design;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < d.nodes.length && !merged; i++) {
      const a = d.nodes[i]!;
      for (let j = i + 1; j < d.nodes.length; j++) {
        const b = d.nodes[j]!;
        if (
          length(sub(a.position, b.position)) < tol &&
          nodeGroupKey(d, a.id) === nodeGroupKey(d, b.id)
        ) {
          d = weldNodes(d, b.id, a.id);
          merged = true;
          break;
        }
      }
    }
  }
  return healBodyJoints(d);
}

/** Dissolve a group and AUTO-SOLVE the unions its boundary deferred: remove the
 * group record, then weld coincident nodes + heal on-body unions across what was
 * the boundary. */
export function ungroupMembers(design: Design, groupId: string): Design {
  const groups = design.groups.filter((g) => g.id !== groupId);
  if (groups.length === design.groups.length) return design;
  return weldCoincidentNodes({ ...design, groups });
}
