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
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Member pairs joined by a joint (mover ↔ receiver): they legitimately touch
 * (a branch on a run body, or two ends butted at a pivot), so their overlap
 * must not be flagged. */
function wrappedPairs(design: Design): Set<string> {
  const out = new Set<string>();
  for (const j of design.joints) out.add(pairKey(j.mover, j.receiver));
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

/** Squared closest distance between segments p1→q1 and p2→q2 (Ericson,
 * Real-Time Collision Detection). */
export function segmentSegmentDistSq(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
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
  return dot(diff, diff);
}

/** Member ids whose pipe overlaps another (non-adjacent) member's pipe. */
export function intersectingMembers(design: Design): Set<string> {
  const byMember = memberSegments(design);
  const members = design.members;
  const nodesOf = new Map(members.map((m) => [m.id, [m.nodeA, m.nodeB]] as const));
  const wrapped = wrappedPairs(design);
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
      if (wrapped.has(pairKey(mi.id, mj.id))) continue;

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
