// Intersection highlighting (planfile §6): find members whose pipe volumes
// overlap (a capsule-vs-capsule test over the members' segments). Members that
// share a node meet legitimately at that joint and are never flagged against
// each other. A heat-wrapped tee is likewise legitimate — its branch touches
// the through pipe by design — so those pairs are excluded too. Pure; the UI
// outlines the returned member ids in red.
import { add, dot, scale, sub } from '../geometry/math3';
import { type Design, pipeSpec, type Vec3 } from '../schema';
import { nodeById } from './docOps';

/** An order-independent key for a member pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Member pairs that legitimately touch because they are wrapped/screwed
 * together at a joint's junction. At each joint's node the whole CLUSTER —
 * the joint's mover + receiver plus every member incident to that node (the
 * two halves of a split run, or extra pipes joined at the same point) —
 * touches by design, so overlap within the cluster must not be flagged. */
function joinedPairs(design: Design): Set<string> {
  const clusters = new Map<string, Set<string>>();
  for (const j of design.joints) {
    let c = clusters.get(j.nodeId);
    if (!c) {
      c = new Set();
      clusters.set(j.nodeId, c);
    }
    c.add(j.mover);
    c.add(j.receiver);
  }
  const out = new Set<string>();
  if (!clusters.size) return out;
  for (const m of design.members) {
    clusters.get(m.nodeA)?.add(m.id);
    clusters.get(m.nodeB)?.add(m.id);
  }
  for (const c of clusters.values()) {
    const ids = [...c];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) out.add(pairKey(ids[i]!, ids[j]!));
  }
  return out;
}

interface Segment {
  memberId: string;
  a: Vec3;
  b: Vec3;
  radiusM: number;
}

/** Every member's pipe as one or more segment-capsules (formed pipes have one
 * per spline leg). */
function memberSegments(design: Design): Map<string, Segment[]> {
  const byMember = new Map<string, Segment[]>();
  for (const m of design.members) {
    const a = nodeById(design, m.nodeA)?.position;
    const b = nodeById(design, m.nodeB)?.position;
    if (!a || !b) continue;
    const radiusM = pipeSpec(m.size).odM / 2;
    const pts = m.kind === 'formed' ? [a, ...m.controlPoints, b] : [a, b];
    const segs: Segment[] = [];
    for (let i = 1; i < pts.length; i++) {
      segs.push({ memberId: m.id, a: pts[i - 1]!, b: pts[i]!, radiusM });
    }
    byMember.set(m.id, segs);
  }
  return byMember;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Closest-approach data between two segments: squared distance, the params of
 * the closest points along each (0..1), and the points themselves. */
export interface SegmentClosest {
  distSq: number;
  /** param of the closest point along p1→q1 */
  s: number;
  /** param of the closest point along p2→q2 */
  t: number;
  /** closest point on p1→q1 */
  pa: Vec3;
  /** closest point on p2→q2 */
  pb: Vec3;
}

/** Closest approach between segments p1→q1 and p2→q2 (Ericson, Real-Time
 * Collision Detection). */
export function segmentSegmentClosest(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): SegmentClosest {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  const diff = sub(c1, c2);
  return { distSq: dot(diff, diff), s, t, pa: c1, pb: c2 };
}

/** Squared closest distance between segments p1→q1 and p2→q2. */
export function segmentSegmentDistSq(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  return segmentSegmentClosest(p1, q1, p2, q2).distSq;
}

/** Member ids whose pipe overlaps another (non-adjacent) member's pipe. */
export function intersectingMembers(design: Design): Set<string> {
  const byMember = memberSegments(design);
  const members = design.members;
  const nodesOf = new Map(members.map((m) => [m.id, [m.nodeA, m.nodeB]] as const));
  const joined = joinedPairs(design);
  const hits = new Set<string>();

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const mi = members[i]!;
      const mj = members[j]!;
      // members sharing a node meet at that joint — never an intersection
      const [ai, bi] = nodesOf.get(mi.id)!;
      const [aj, bj] = nodesOf.get(mj.id)!;
      if (ai === aj || ai === bj || bi === aj || bi === bj) continue;
      // a heat-wrapped branch legitimately touches its through pipe
      if (joined.has(pairKey(mi.id, mj.id))) continue;

      const segsI = byMember.get(mi.id) ?? [];
      const segsJ = byMember.get(mj.id) ?? [];
      let overlap = false;
      for (const si of segsI) {
        for (const sj of segsJ) {
          const reach = si.radiusM + sj.radiusM - 1e-4;
          if (segmentSegmentDistSq(si.a, si.b, sj.a, sj.b) < reach * reach) {
            overlap = true;
            break;
          }
        }
        if (overlap) break;
      }
      if (overlap) {
        hits.add(mi.id);
        hits.add(mj.id);
      }
    }
  }
  return hits;
}

/** One side of a pipe-pipe crossing: the closest-approach geometry ON that
 * member's own centre-line polyline. A straight member is one leg (index 0);
 * a formed member has one leg per spline segment (nodeA → controls → nodeB). */
export interface CrossingSide {
  memberId: string;
  /** polyline leg index carrying the closest point */
  leg: number;
  /** param of the closest point within that leg (0..1) */
  t: number;
  /** the closest point on this member's centre-line */
  point: Vec3;
}

/** One overlapping member pair's closest crossing. */
export interface MemberCrossing {
  a: CrossingSide;
  b: CrossingSide;
}

/** Every overlapping member pair — straight AND formed — with its closest
 * crossing (the minimum leg-to-leg approach), the junctions
 * `solveIntersections` joins. Same exclusions + tolerance as
 * `intersectingMembers`. */
export function intersectingMemberPairs(design: Design): MemberCrossing[] {
  const byMember = memberSegments(design);
  const members = design.members;
  const joined = joinedPairs(design);
  const out: MemberCrossing[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const mi = members[i]!;
      const mj = members[j]!;
      if (
        mi.nodeA === mj.nodeA ||
        mi.nodeA === mj.nodeB ||
        mi.nodeB === mj.nodeA ||
        mi.nodeB === mj.nodeB
      )
        continue;
      if (joined.has(pairKey(mi.id, mj.id))) continue;
      const segsI = byMember.get(mi.id) ?? [];
      const segsJ = byMember.get(mj.id) ?? [];
      let best: { distSq: number; li: number; lj: number; c: SegmentClosest } | null = null;
      for (let li = 0; li < segsI.length; li++) {
        for (let lj = 0; lj < segsJ.length; lj++) {
          const si = segsI[li]!;
          const sj = segsJ[lj]!;
          const reach = si.radiusM + sj.radiusM - 1e-4;
          const c = segmentSegmentClosest(si.a, si.b, sj.a, sj.b);
          if (c.distSq < reach * reach && (!best || c.distSq < best.distSq))
            best = { distSq: c.distSq, li, lj, c };
        }
      }
      if (best)
        out.push({
          a: { memberId: mi.id, leg: best.li, t: best.c.s, point: best.c.pa },
          b: { memberId: mj.id, leg: best.lj, t: best.c.t, point: best.c.pb },
        });
    }
  }
  return out;
}
