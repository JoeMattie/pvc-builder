// "Solve intersections" — the red-warning auto-fix, in two passes.
//
// PASS 1 (overlaps): scans for pipe-pipe crossings — straight AND formed
// (heat-bent) members — CLUSTERS crossings that share one point (three, four,
// or more pipes through the same spot form ONE junction), and joins every pipe
// of each cluster to a single node with RIGID unions: physically the user
// heat-wraps the pipes around each other and screws them — the app's
// fabricated anchor semantics, so `resolveFittings` never classifies the
// junction (the joint IS its fitting) and many-way crossings at non-standard
// angles are first-class and warning-free. A formed pipe can never be an
// on-body RECEIVER (that machinery is straight-only), so formed members are
// CUT at the junction (`splitFormedAt`) and their halves share the node; cuts
// that would land inside a bend's fold window are refused and that crossing
// stays flagged instead of mangling the bend.
//
// PASS 2 (junction conflicts): nodes `resolveFittings` flags because no
// standard fitting exists there and no joint record covers them — including
// corners pass 1 itself creates by welding ends. TWO pipe ends meeting at a
// nonstandard angle merge into ONE formed member bent at the junction (a
// heat-bent corner: developed length + bend schedule flow into the BOM);
// THREE+ ends with no standard fitting get explicit fabricated anchor records
// (the brown hub). Standard-angle corners never conflict and keep resolving as
// normal fittings.
//
// Pure `Design → Design`; applied via `appStore.updateCurrent` by the action.
import { add, dot, length, scale, sub } from '../geometry/math3';
import {
  type Attachment,
  type Design,
  type Joint,
  type MeasurementEnd,
  type Member,
  pipeSpec,
  type Vec3,
} from '../schema';
import {
  addBodyJoint,
  addMember,
  incidentMembers,
  jointsAtNode,
  memberById,
  memberEndpoints,
  memberGroupKey,
  memberLengthM,
  nodeById,
  ON_BODY_KEEP_TOL_M,
  setNodePosition,
  splitFormedAt,
  splitMemberAt,
  weldNodes,
} from './docOps';
import { resolveFittings } from './fittings';
import { makeId } from './ids';
import { intersectingMemberPairs } from './intersections';
import { closestPointOnSegment } from './snapping';

/** Clamped param (0..1) of the point on segment a→b closest to `p`. */
function paramOn(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  return len2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2)) : 0;
}

/** One junction-to-be: every member (straight or formed) crossing at (roughly)
 * `point`. */
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
  for (const c of intersectingMemberPairs(design)) {
    const mid = scale(add(c.a.point, c.b.point), 0.5);
    const a = memberById(design, c.a.memberId);
    const b = memberById(design, c.b.memberId);
    if (!a || !b) continue;
    const reach = pipeSpec(a.size).odM / 2 + pipeSpec(b.size).odM / 2;
    const found = clusters.find((cl) => length(sub(cl.point, mid)) <= Math.max(cl.tol, reach));
    if (found) {
      found.tol = Math.max(found.tol, reach);
      if (!found.memberIds.includes(c.a.memberId)) found.memberIds.push(c.a.memberId);
      if (!found.memberIds.includes(c.b.memberId)) found.memberIds.push(c.b.memberId);
    } else {
      clusters.push({ point: mid, tol: reach, memberIds: [c.a.memberId, c.b.memberId] });
    }
  }
  return clusters;
}

/** Closest approach of `member`'s centre-line polyline to `p`: the point, and
 * the ARC distance from it to each end (formed legs summed; a straight member
 * is one leg). */
function closestOnMember(
  design: Design,
  member: Member,
  p: Vec3,
): { point: Vec3; arcToA: number; arcToB: number } | null {
  const a = nodeById(design, member.nodeA)?.position;
  const b = nodeById(design, member.nodeB)?.position;
  if (!a || !b) return null;
  const pts = member.kind === 'formed' ? [a, ...member.controlPoints, b] : [a, b];
  const legLens: number[] = [];
  let best = { d: Number.POSITIVE_INFINITY, leg: 0, point: a };
  for (let i = 0; i < pts.length - 1; i++) {
    legLens.push(length(sub(pts[i + 1]!, pts[i]!)));
    const q = closestPointOnSegment(p, pts[i]!, pts[i + 1]!);
    const dd = length(sub(q, p));
    if (dd < best.d) best = { d: dd, leg: i, point: q };
  }
  let arcToA = length(sub(best.point, pts[best.leg]!));
  for (let i = 0; i < best.leg; i++) arcToA += legLens[i]!;
  const total = legLens.reduce((s, x) => s + x, 0);
  return { point: best.point, arcToA, arcToB: total - arcToA };
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
 * their end node (the first becomes the junction; the rest are welded into it).
 * STRAIGHT members passing THROUGH get an on-body anchor record while a free
 * mover exists and the node sits exactly on their centre-line, and are
 * otherwise cut at the node; FORMED members passing through are always cut
 * (`splitFormedAt` — a formed pipe can never be an on-body receiver), their
 * halves sharing the junction node. Returns the joined design + how many pipes
 * were newly tied into the junction. */
function joinCluster(design: Design, cluster: CrossingCluster): { design: Design; joined: number } {
  interface Info {
    id: string;
    kind: Member['kind'];
    endDist: number;
    endNode: string;
    /** closest point on this member's own centre-line polyline */
    point: Vec3;
  }
  const odOf = (id: string): number => {
    const m = memberById(design, id);
    return m ? pipeSpec(m.size).odM : 0;
  };
  const maxOd = Math.max(...cluster.memberIds.map(odOf));
  const infos: Info[] = [];
  for (const id of cluster.memberIds) {
    const m = memberById(design, id);
    if (!m) continue;
    const c = closestOnMember(design, m, cluster.point);
    if (!c) continue;
    infos.push({
      id,
      kind: m.kind,
      endDist: Math.min(c.arcToA, c.arcToB),
      endNode: c.arcToA <= c.arcToB ? m.nodeA : m.nodeB,
      point: c.point,
    });
  }
  if (infos.length < 2) return { design, joined: 0 };
  // "ends at the crossing" = the crossing sits within one touching distance of
  // the member's endpoint — a split there would leave a uselessly short stub
  const isEnder = (i: Info) => i.endDist <= odOf(i.id) / 2 + maxOd / 2;
  const enders = infos.filter(isEnder);
  let throughs = infos.filter((i) => !isEnder(i));

  let d = design;
  let joined = 0;
  let nodeId: string;
  if (enders.length) {
    // T case: a member already ENDS at the crossing — its end node is the
    // junction, pulled exactly onto a straight through's centre-line when one
    // exists (the on-body invariant; formed throughs get cut wherever it sits)
    nodeId = enders[0]!.endNode;
    const target = throughs.find((x) => x.kind === 'straight')?.point ?? null;
    const cur = nodeById(d, nodeId)?.position;
    if (target && cur && length(sub(target, cur)) > 1e-9 && canMoveJunction(d, nodeId, target))
      d = setNodePosition(d, nodeId, target);
  } else {
    // X case: cut a member and host the junction at its split node. A formed
    // pipe can never be an on-body receiver, so when formed pipes cross here
    // one of THEM is cut (straights stay intact as receivers); among
    // candidates, cut the one whose crossing is FARTHEST from its ends
    const pick = (list: Info[]) => list.reduce((best, x) => (x.endDist > best.endDist ? x : best));
    const formedThroughs = throughs.filter((x) => x.kind === 'formed');
    const host = formedThroughs.length ? pick(formedThroughs) : pick(throughs);
    throughs = throughs.filter((x) => x !== host);
    // the junction lands exactly on a straight through's centre-line when one
    // exists (the on-body invariant); else on the host's own closest point
    const target = throughs.find((x) => x.kind === 'straight')?.point ?? host.point;
    const r =
      host.kind === 'formed'
        ? splitFormedAt(d, host.id, target)
        : splitMemberAt(d, host.id, target);
    if (!r.nodeId) return { design, joined: 0 };
    if (r.design === d) {
      // an existing node was reused without a cut — the host still passes
      // through the junction: join it like the other through pipes
      throughs.unshift(host);
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

  // every THROUGH member: a straight one gets an on-body anchor record while
  // the node sits on its centre-line and a free mover remains (else it's cut at
  // the node); a formed one is always cut, its halves sharing the node
  for (const t of throughs) {
    const m = memberById(d, t.id);
    if (!m) continue;
    if (m.nodeA === nodeId || m.nodeB === nodeId) continue; // already incident
    const nPos = nodeById(d, nodeId)?.position;
    if (!nPos) continue;
    if (m.kind === 'straight') {
      const e = memberEndpoints(d, m);
      if (!e) continue;
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
      continue;
    }
    // formed through: cut it at the junction; a refusal (fold window /
    // unsupported references) leaves the crossing flagged — the re-scan puts
    // that residue into the skip set instead of mangling the bend
    const r = splitFormedAt(d, m.id, nPos);
    if (!r.nodeId) continue;
    if (r.nodeId === nodeId) {
      if (r.design !== d) {
        d = r.design;
        joined++;
      }
    } else {
      // the cut landed on a different (coincident) node — weld it in
      d = weldNodes(r.design, r.nodeId, nodeId);
      joined++;
    }
  }

  // a recordless junction this cluster produced (e.g. two welded ends at an
  // odd angle) is left to PASS 2, which turns 2-end corners into heat-bent
  // pipe and covers many-way ends with fabricated records
  return { design: d, joined };
}

/** Merge the TWO members meeting end-to-end at `nodeId` into ONE formed
 * (heat-bent) member whose bend is the junction — the solve for a sharp
 * NONSTANDARD corner (no standard elbow exists): the corner becomes bent pipe,
 * so developed length + bend schedule flow into the BOM and the node stops
 * classifying. Straight and formed members both merge (control points
 * concatenate through the corner). Returns null when the merge doesn't apply:
 * sizes differ, a member serves as a joint RECEIVER anywhere (receivers must
 * stay straight for the on-body machinery), an elastic rides one of them, the
 * two sit in different groups, or the pair closes a loop. */
function mergeCornerIntoBend(design: Design, nodeId: string): Design | null {
  const inc = incidentMembers(design, nodeId);
  if (inc.length !== 2) return null;
  const [m1, m2] = inc as [Member, Member];
  if (m1.size !== m2.size) return null;
  if (design.joints.some((j) => j.receiver === m1.id || j.receiver === m2.id)) return null;
  const ridesMember = (att: Attachment) =>
    'memberId' in att && (att.memberId === m1.id || att.memberId === m2.id);
  if (design.elastics.some((e) => ridesMember(e.a) || ridesMember(e.b))) return null;
  if (memberGroupKey(design, m1.id) !== memberGroupKey(design, m2.id)) return null;
  const nPos = nodeById(design, nodeId)?.position;
  if (!nPos) return null;

  /** a member's far node + its interior control points/fillets ordered LEAVING
   * the corner node (node → far). */
  const legOf = (m: Member) => {
    const far = m.nodeA === nodeId ? m.nodeB : m.nodeA;
    if (m.kind !== 'formed') return { far, controls: [] as Vec3[], fillets: [] as number[] };
    const controls = [...m.controlPoints];
    const fillets = m.controlPoints.map((_, i) => m.filletRadiiM?.[i] ?? 0);
    if (m.nodeB === nodeId) {
      controls.reverse();
      fillets.reverse();
    }
    return { far, controls, fillets };
  };
  const leg1 = legOf(m1);
  const leg2 = legOf(m2);
  if (leg1.far === leg2.far || leg1.far === nodeId || leg2.far === nodeId) return null;
  const aPos = nodeById(design, leg1.far)?.position;
  const bPos = nodeById(design, leg2.far)?.position;
  if (!aPos || !bPos) return null;

  // A solved corner is a FOLD — heated and creased sharp, the way the user
  // actually fabricates. Fillet 0 = a deliberate crease (exempt from the
  // tight-bend warning by definition: `belowMin` requires a positive radius).
  // The rendered spline is Catmull-Rom, so sharpness needs HUG points pinning
  // the curve to the legs just before/after the corner — otherwise the fold
  // renders as a wide arc regardless of fillet. Hug points sit ~1 OD out and
  // carry ~0° deflection, which analyzeFormed ignores (below its bend epsilon).
  const near1 = leg1.controls[0] ?? aPos;
  const near2 = leg2.controls[0] ?? bPos;
  const len1 = length(sub(near1, nPos));
  const len2 = length(sub(near2, nPos));
  if (len1 <= 0 || len2 <= 0) return null;
  // hug distance sets the visual fold radius (the spline turns within ~hug):
  // 1 OD read too sharp, the old 3-OD fillet too round — 2 OD sits right
  const hug = Math.min(2 * pipeSpec(m1.size).odM, 0.35 * len1, 0.35 * len2);
  const hugPt = (toward: Vec3, legLen: number): Vec3 =>
    add(nPos, scale(sub(toward, nPos), hug / legLen));
  const fold: Vec3[] = [hugPt(near1, len1), { ...nPos }, hugPt(near2, len2)];

  // polyline: leg1.far → (leg1 interior, reversed to far→node) → hug → corner
  // → hug → leg2 interior → leg2.far
  const merged: Member = {
    id: makeId('m'),
    kind: 'formed',
    nodeA: leg1.far,
    nodeB: leg2.far,
    size: m1.size,
    controlPoints: [...[...leg1.controls].reverse(), ...fold, ...leg2.controls],
    filletRadiiM: [...[...leg1.fillets].reverse(), 0, 0, 0, ...leg2.fillets],
  };
  const members = [...design.members.filter((m) => m.id !== m1.id && m.id !== m2.id), merged];
  // joints AT the corner vanish with it; movers elsewhere follow the merge
  // (movers may be formed — receivers can't, guarded above)
  const joints = design.joints
    .filter((j) => j.nodeId !== nodeId)
    .map((j) => (j.mover === m1.id || j.mover === m2.id ? { ...j, mover: merged.id } : j));
  // the corner node becomes the bend control point — prune it, and drop any
  // tape measure pinned to it (its anchor no longer exists)
  const nodes = design.nodes.filter((n) => n.id !== nodeId);
  const pinsNode = (end: MeasurementEnd) => 'nodeId' in end && end.nodeId === nodeId;
  const measurements = design.measurements.filter((ms) => !pinsNode(ms.a) && !pinsNode(ms.b));
  const groups = design.groups.map((g) =>
    g.memberIds.includes(m1.id) || g.memberIds.includes(m2.id)
      ? {
          ...g,
          memberIds: [...g.memberIds.filter((x) => x !== m1.id && x !== m2.id), merged.id],
        }
      : g,
  );
  return { ...design, nodes, members, joints, measurements, groups };
}

/** Cover a junction that has no standard fitting with explicit fabricated
 * anchor records — one per non-receiver incident member (one record per mover,
 * like the existing multi-joint nodes), with the longest straight incident as
 * the shared receiver. The node then reads as rigid fabricated hardware (the
 * brown hub), never a conflict. Returns null when nothing can be recorded. */
function recordFabricatedUnion(design: Design, nodeId: string): Design | null {
  const inc = incidentMembers(design, nodeId);
  if (inc.length < 2) return null;
  const straight = inc.filter((m) => m.kind === 'straight');
  const pool = straight.length ? straight : inc;
  const receiver = [...pool].sort(
    (a, b) => memberLengthM(design, b) - memberLengthM(design, a),
  )[0]!;
  const taken = new Set(design.joints.filter((j) => j.nodeId === nodeId).map((j) => j.mover));
  const added: Joint[] = [];
  for (const m of inc) {
    if (m.id === receiver.id || taken.has(m.id)) continue;
    added.push({
      id: makeId('jt'),
      nodeId,
      receiver: receiver.id,
      mover: m.id,
      onBody: false,
      mode: 'anchor',
    });
  }
  if (!added.length) return null;
  return { ...design, joints: [...design.joints, ...added] };
}

const clusterKey = (c: CrossingCluster): string => [...c.memberIds].sort().join('|');

/** Solve every red warning the design's junction geometry can absorb — the
 * "Solve intersections" action. PASS 1: overlap crossings (clustered by point,
 * so three/four/more pipes through one spot join at the SAME node); pass 1
 * re-scans after every cluster because splits rename member ids (id remapping
 * is never tracked across iterations), joined clusters drop out of the scan,
 * and unjoinable ones are skipped permanently. PASS 2: junction conflicts —
 * a 2-end nonstandard corner merges into ONE heat-bent (formed) member bent at
 * the junction; 3+ ends with no standard fitting get fabricated anchor records
 * (the brown hub). Both passes are idempotent: a second run changes nothing.
 * Returns the solved design + how many fixes were applied. */
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

  // PASS 2: junction conflicts (recordless nodes with no standard fitting) —
  // re-resolve after every fix because a bend merge renames member ids
  const skippedNodes = new Set<string>();
  for (let guard = 0; guard < 1000; guard++) {
    const conflict = resolveFittings(d).conflicts.find((c) => !skippedNodes.has(c.nodeId));
    if (!conflict) break;
    const inc = incidentMembers(d, conflict.nodeId);
    const fixed =
      (inc.length === 2 ? mergeCornerIntoBend(d, conflict.nodeId) : null) ??
      recordFabricatedUnion(d, conflict.nodeId);
    if (fixed) {
      d = fixed;
      joined++;
    } else {
      skippedNodes.add(conflict.nodeId);
    }
  }
  return { design: d, joined };
}
