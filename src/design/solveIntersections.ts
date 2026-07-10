// "Solve intersections" — the red-overlap auto-fix. Scans the design for
// pipe-pipe crossings, CLUSTERS crossings that share one point (three, four, or
// more pipes through the same spot form ONE junction), and joins every pipe of
// each cluster to a single node with RIGID unions: physically the user
// heat-wraps the pipes around each other and screws them — the app's fabricated
// anchor semantics, so `resolveFittings` never classifies the junction (the
// joint IS its fitting) and many-way crossings at non-standard angles are
// first-class and warning-free. STRAIGHT×STRAIGHT only: formed (heat-bent)
// splines are out of scope and their overlaps stay flagged for manual fixing.
// Pure `Design → Design`; applied via `appStore.updateCurrent` by the action.
import { add, dot, length, scale, sub } from '../geometry/math3';
import { type Attachment, type Design, type Joint, pipeSpec, type Vec3 } from '../schema';
import {
  addBodyJoint,
  addMember,
  incidentMembers,
  jointsAtNode,
  memberById,
  memberEndpoints,
  memberLengthM,
  nodeById,
  ON_BODY_KEEP_TOL_M,
  setNodePosition,
  splitMemberAt,
  weldNodes,
} from './docOps';
import { resolveFittings } from './fittings';
import { makeId } from './ids';
import { intersectingStraightPairs } from './intersections';
import { closestPointOnSegment } from './snapping';

/** Clamped param (0..1) of the point on segment a→b closest to `p`. */
function paramOn(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  return len2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2)) : 0;
}

/** One junction-to-be: every straight member crossing at (roughly) `point`. */
interface CrossingCluster {
  /** representative crossing point (the first crossing's capsule midpoint) */
  point: Vec3;
  /** ids of every member passing through / ending at the point */
  memberIds: string[];
}

/** Group the pairwise crossings by proximity: crossings whose points fall
 * within one touching distance of each other are the SAME junction (three+
 * pipes through one point produce a pairwise crossing per pair — they must all
 * join at ONE node, not one node per pair). Distinct crossings farther apart
 * along the same member stay separate clusters. */
function crossingClusters(design: Design): CrossingCluster[] {
  const clusters: (CrossingCluster & { tol: number })[] = [];
  for (const c of intersectingStraightPairs(design)) {
    const mid = scale(add(c.pa, c.pb), 0.5);
    const a = memberById(design, c.aId);
    const b = memberById(design, c.bId);
    if (!a || !b) continue;
    const reach = pipeSpec(a.size).odM / 2 + pipeSpec(b.size).odM / 2;
    const found = clusters.find((cl) => length(sub(cl.point, mid)) <= Math.max(cl.tol, reach));
    if (found) {
      found.tol = Math.max(found.tol, reach);
      if (!found.memberIds.includes(c.aId)) found.memberIds.push(c.aId);
      if (!found.memberIds.includes(c.bId)) found.memberIds.push(c.bId);
    } else {
      clusters.push({ point: mid, tol: reach, memberIds: [c.aId, c.bId] });
    }
  }
  return clusters;
}

/** Can `nodeId` move to `target` without detaching an existing on-body union at
 * that node? Each such union's receiver centre-line must stay within the keep
 * tolerance, or `reconcileBodyJoints` would drop it on the next edit. */
function canMoveJunction(design: Design, nodeId: string, target: Vec3): boolean {
  for (const j of jointsAtNode(design, nodeId)) {
    if (!j.onBody) continue; // end-to-end joints simply ride the node
    const recv = memberById(design, j.receiver);
    if (recv?.kind !== 'straight') return false;
    const e = memberEndpoints(design, recv);
    if (!e) return false;
    if (length(sub(closestPointOnSegment(target, e.a, e.b), target)) > ON_BODY_KEEP_TOL_M)
      return false;
  }
  return true;
}

/** Split straight `memberId` at the EXISTING node `nodeId` (not one of its own
 * endpoints): replace A–B with A–N and N–B sharing that node — the rigid
 * default union, used when a through pipe can't take an on-body record (no
 * free mover left, or the node sits off its centre-line). Joints, elastic
 * attachments, and group membership referencing the member are remapped to the
 * half that carries them. (`splitMemberAt` can't do this — it reuses an
 * existing node WITHOUT splitting.) */
function splitAtExistingNode(design: Design, memberId: string, nodeId: string): Design {
  const m = memberById(design, memberId);
  if (m?.kind !== 'straight') return design;
  if (m.nodeA === nodeId || m.nodeB === nodeId) return design;
  const aPos = nodeById(design, m.nodeA)?.position;
  const bPos = nodeById(design, m.nodeB)?.position;
  const nPos = nodeById(design, nodeId)?.position;
  if (!aPos || !bPos || !nPos) return design;
  const r1 = addMember(design, m.nodeA, nodeId, m.size);
  const r2 = addMember(r1.design, nodeId, m.nodeB, m.size);
  const h1 = r1.memberId;
  const h2 = r2.memberId;
  /** the half whose span carries point `p` of the original member */
  const halfOf = (p: Vec3): string =>
    length(sub(closestPointOnSegment(p, aPos, nPos), p)) <=
    length(sub(closestPointOnSegment(p, nPos, bPos), p))
      ? h1
      : h2;
  const joints = r2.design.joints.map((j) => {
    if (j.receiver !== memberId && j.mover !== memberId) return j;
    const at = nodeById(r2.design, j.nodeId)?.position ?? nPos;
    return {
      ...j,
      receiver: j.receiver === memberId ? halfOf(at) : j.receiver,
      mover: j.mover === memberId ? halfOf(at) : j.mover,
    };
  });
  const remapAttachment = (att: Attachment): Attachment => {
    if (!('memberId' in att) || att.memberId !== memberId) return att;
    const p = add(aPos, scale(sub(bPos, aPos), att.t));
    const hid = halfOf(p);
    const [ha, hb] = hid === h1 ? ([aPos, nPos] as const) : ([nPos, bPos] as const);
    return { memberId: hid, t: paramOn(ha, hb, p) };
  };
  const elastics = r2.design.elastics.map((el) => ({
    ...el,
    a: remapAttachment(el.a),
    b: remapAttachment(el.b),
  }));
  const groups = r2.design.groups.map((g) =>
    g.memberIds.includes(memberId)
      ? { ...g, memberIds: [...g.memberIds.filter((x) => x !== memberId), h1, h2] }
      : g,
  );
  return {
    ...r2.design,
    members: r2.design.members.filter((mm) => mm.id !== memberId),
    joints,
    elastics,
    groups,
  };
}

/** Join a whole cluster at ONE node. Members ENDING at the point contribute
 * their end node (the first becomes the junction; the rest are welded into it);
 * members passing THROUGH get an on-body anchor record while a free mover
 * exists and the node sits exactly on their centre-line, and are otherwise cut
 * at the node (the halves share it — the rigid default union — and provide
 * fresh movers for the pipes after them). Returns the joined design + how many
 * pipes were newly tied into the junction. */
function joinCluster(design: Design, cluster: CrossingCluster): { design: Design; joined: number } {
  interface Info {
    id: string;
    endDist: number;
    endNode: string;
  }
  const odOf = (id: string): number => {
    const m = memberById(design, id);
    return m ? pipeSpec(m.size).odM : 0;
  };
  const maxOd = Math.max(...cluster.memberIds.map(odOf));
  const infos: Info[] = [];
  for (const id of cluster.memberIds) {
    const m = memberById(design, id);
    if (m?.kind !== 'straight') continue;
    const e = memberEndpoints(design, m);
    if (!e) continue;
    const t = paramOn(e.a, e.b, cluster.point);
    infos.push({
      id,
      endDist: Math.min(t, 1 - t) * length(sub(e.b, e.a)),
      endNode: t < 0.5 ? m.nodeA : m.nodeB,
    });
  }
  if (infos.length < 2) return { design, joined: 0 };
  // "ends at the crossing" = the crossing sits within one touching distance of
  // the member's endpoint — a split there would leave a uselessly short stub
  const isEnder = (i: Info) => i.endDist <= odOf(i.id) / 2 + maxOd / 2;
  const enders = infos.filter(isEnder);
  let throughs = infos.filter((i) => !isEnder(i));
  /** the junction target position: exactly on `ref`'s centre-line, so on-body
   * records survive `reconcileBodyJoints` */
  const targetOn = (d: Design, ref: Info): Vec3 | null => {
    const m = memberById(d, ref.id);
    const e = m ? memberEndpoints(d, m) : null;
    return e ? closestPointOnSegment(cluster.point, e.a, e.b) : null;
  };

  let d = design;
  let joined = 0;
  let nodeId: string;
  if (enders.length) {
    // T case: a member already ENDS at the crossing — its end node is the junction
    nodeId = enders[0]!.endNode;
    const target = throughs.length ? targetOn(d, throughs[0]!) : null;
    const cur = nodeById(d, nodeId)?.position;
    if (target && cur && length(sub(target, cur)) > 1e-9 && canMoveJunction(d, nodeId, target))
      d = setNodePosition(d, nodeId, target);
  } else {
    // X case: split the member whose crossing point is FARTHEST from its ends
    // (so the stubs stay long); the new node lands on another member's line
    const s = throughs.reduce((best, x) => (x.endDist > best.endDist ? x : best));
    throughs = throughs.filter((x) => x !== s);
    const target = throughs.length ? targetOn(d, throughs[0]!) : null;
    if (!target) return { design, joined: 0 };
    const r = splitMemberAt(d, s.id, target);
    if (!r.nodeId) return { design, joined: 0 };
    if (r.design === d) {
      // an existing node was reused — `s` wasn't actually split and still
      // passes through the junction: join it like the other through pipes
      throughs.unshift(s);
    } else {
      d = r.design;
    }
    nodeId = r.nodeId;
  }

  // every other ENDING member: weld its end into the junction node
  for (const e of enders.slice(1)) {
    if (e.endNode === nodeId || !nodeById(d, e.endNode)) continue;
    d = weldNodes(d, e.endNode, nodeId);
    joined++;
  }

  // every THROUGH member: an on-body anchor record while the node sits on its
  // centre-line and a free mover remains; otherwise cut it at the node
  for (const t of throughs) {
    const m = memberById(d, t.id);
    if (m?.kind !== 'straight') continue;
    if (m.nodeA === nodeId || m.nodeB === nodeId) continue; // already incident
    const e = memberEndpoints(d, m);
    const nPos = nodeById(d, nodeId)?.position;
    if (!e || !nPos) continue;
    const onLine = length(sub(closestPointOnSegment(nPos, e.a, e.b), nPos)) <= ON_BODY_KEEP_TOL_M;
    if (onLine) {
      const r = addBodyJoint(d, t.id, nodeId, 'anchor');
      if (r.jointId) {
        d = r.design;
        joined++;
        continue;
      }
    }
    const next = splitAtExistingNode(d, t.id, nodeId);
    if (next !== d) {
      d = next;
      joined++;
    }
  }

  // a junction that ended up with NO joint record (every member welded/split
  // into shared-node unions) is classified by resolveFittings — if the welded
  // geometry has no standard fitting, record ONE explicit fabricated anchor
  // union so the node reads as hardware, never as a conflict
  if (
    joined > 0 &&
    jointsAtNode(d, nodeId).length === 0 &&
    resolveFittings(d).conflicts.some((c) => c.nodeId === nodeId)
  ) {
    const inc = incidentMembers(d, nodeId).sort(
      (a, b) => memberLengthM(d, b) - memberLengthM(d, a),
    );
    if (inc.length >= 2) {
      const joint: Joint = {
        id: makeId('jt'),
        nodeId,
        receiver: inc[0]!.id,
        mover: inc[1]!.id,
        onBody: false,
        mode: 'anchor',
      };
      d = { ...d, joints: [...d.joints, joint] };
    }
  }
  return { design: d, joined };
}

const clusterKey = (c: CrossingCluster): string => [...c.memberIds].sort().join('|');

/** Join every red pipe-pipe crossing with rigid fabricated unions — the "Solve
 * intersections" action. STRAIGHT×STRAIGHT crossings only; formed splines are
 * out of scope. Crossings are clustered by point FIRST, so three, four, or more
 * pipes through one spot all join at the SAME node. Re-scans after every
 * cluster because splits rename member ids (id remapping is never tracked
 * across iterations); joined clusters are excluded from the next scan and
 * unjoinable ones skipped permanently, so the loop terminates and a second run
 * joins nothing (idempotent). Returns the solved design + how many pipes were
 * newly tied into a junction. */
export function solveIntersections(design: Design): { design: Design; joined: number } {
  let d = design;
  let joined = 0;
  const skipped = new Set<string>(); // unjoinable clusters — never retried
  // hard cap as a belt-and-braces guard; every iteration either makes progress
  // (which excludes the cluster from the re-scan) or skips it permanently
  for (let guard = 0; guard < 1000; guard++) {
    const cluster = crossingClusters(d).find((c) => !skipped.has(clusterKey(c)));
    if (!cluster) break;
    const r = joinCluster(d, cluster);
    if (r.joined > 0) {
      d = r.design;
      joined += r.joined;
    } else {
      skipped.add(clusterKey(cluster));
    }
  }
  return { design: d, joined };
}
