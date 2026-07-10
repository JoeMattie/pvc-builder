// Construction guide lines (planfile: the Q tool). A guide is an INFINITE line
// (a point + a unit direction, axis-snapped) that persists on the canvas as a
// snapping aid. Pure geometry only — no three.js / store types. Guides live in
// transient editor state, not the document.
import { add, dot, length, normalize, scale, sub } from '../geometry/math3';
import type { Vec3 } from '../schema';

/** An infinite construction line: all points `origin + t·dir` (dir unit). */
export interface Guide {
  id: string;
  origin: Vec3;
  dir: Vec3;
}

/** A straight pipe segment for guide intersection (endpoints only). */
export interface GuideSegment {
  a: Vec3;
  b: Vec3;
}

/** How close (world m) the guide line and a pipe must pass to count as crossing.
 * Guides + pipes are usually axis-aligned, so real crossings are near-exact. */
export const GUIDE_HIT_TOL_M = 1.5e-3;

/** Snap a unit direction to the nearest of the 3 world axes (sign normalised to
 * positive) — a guide is "parallel to the pipe but snapped to the nearest
 * on-axis direction". */
export function snapDirToAxis(dir: Vec3): Vec3 {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ax >= ay && ax >= az) return { x: 1, y: 0, z: 0 };
  if (ay >= ax && ay >= az) return { x: 0, y: 1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

/** Closest points between an infinite line (p0 + s·u) and a segment (a→b,
 * t∈[0,1]). Returns the two points and their gap, or null if degenerate. */
function lineSegmentClosest(
  p0: Vec3,
  u: Vec3,
  a: Vec3,
  b: Vec3,
): { onLine: Vec3; onSeg: Vec3; gap: number } | null {
  const v = sub(b, a);
  const vv = dot(v, v);
  if (vv < 1e-18) return null;
  const w0 = sub(p0, a);
  const uu = dot(u, u); // 1 for a unit dir, but stay general
  const uv = dot(u, v);
  const uw = dot(u, w0);
  const vw = dot(v, w0);
  const denom = uu * vv - uv * uv;
  let s: number;
  let t: number;
  if (Math.abs(denom) < 1e-12) {
    // parallel: pin the line param to a's projection
    s = uw / (uu || 1);
    t = 0;
  } else {
    s = (uv * vw - vv * uw) / denom;
    t = (uu * vw - uv * uw) / denom;
  }
  t = Math.max(0, Math.min(1, t));
  const onLine = add(p0, scale(u, s));
  const onSeg = add(a, scale(v, t));
  return { onLine, onSeg, gap: length(sub(onLine, onSeg)) };
}

/** Every point where a guide line crosses a pipe segment (within tolerance),
 * de-duplicated by proximity. These become END-priority snap targets. */
export function guideIntersections(
  guides: Guide[],
  segments: GuideSegment[],
  tol = GUIDE_HIT_TOL_M,
): Vec3[] {
  const out: Vec3[] = [];
  const pushUnique = (p: Vec3) => {
    if (!out.some((q) => length(sub(q, p)) < tol * 4)) out.push(p);
  };
  for (const g of guides) {
    const u = normalize(g.dir);
    if (length(u) < 1e-9) continue;
    for (const s of segments) {
      const c = lineSegmentClosest(g.origin, u, s.a, s.b);
      if (c && c.gap <= tol) pushUnique(c.onSeg);
    }
  }
  return out;
}

/** The perpendicular offset (world m) of `point` from the guide's reference line
 * `refOrigin` + t·dir — the "distance value" shown while placing a guide. */
export function perpOffsetM(refOrigin: Vec3, dir: Vec3, point: Vec3): number {
  const u = normalize(dir);
  const rel = sub(point, refOrigin);
  const along = scale(u, dot(rel, u));
  return length(sub(rel, along));
}

/** The unit perpendicular (in the plane of the cursor) from the reference line
 * toward `point`, or null when `point` lies on the line. Used to place a guide
 * at an exact typed offset. */
export function perpUnit(refOrigin: Vec3, dir: Vec3, point: Vec3): Vec3 | null {
  const u = normalize(dir);
  const rel = sub(point, refOrigin);
  const perp = sub(rel, scale(u, dot(rel, u)));
  return length(perp) < 1e-9 ? null : normalize(perp);
}

/** Constrain guide placement to a PURE-AXIS perpendicular offset from the
 * reference point: of the world axes perpendicular to the guide direction, pick
 * the one the cursor is most displaced along, grid-snap that offset, and return
 * the guide origin (`refOrigin + axis·offset`). Placement therefore never
 * tracks the free ground cursor — a guide always sits at an X/Y/Z offset from
 * the picked pipe, so its pipe intersections stay exact. */
export function axisOffsetGuideOrigin(
  refOrigin: Vec3,
  dir: Vec3,
  cursor: Vec3,
  gridStepM = 0,
): { origin: Vec3; axis: Vec3; offsetM: number } {
  const u = snapDirToAxis(normalize(dir));
  const rel = sub(cursor, refOrigin);
  const axes: Vec3[] = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ].filter((a) => Math.abs(dot(a, u)) < 0.5);
  let best = axes[0] ?? { x: 0, y: 1, z: 0 };
  let bestOff = dot(rel, best);
  for (const a of axes) {
    const off = dot(rel, a);
    if (Math.abs(off) > Math.abs(bestOff)) {
      best = a;
      bestOff = off;
    }
  }
  const snapped = gridStepM > 0 ? Math.round(bestOff / gridStepM) * gridStepM : bestOff;
  return { origin: add(refOrigin, scale(best, snapped)), axis: best, offsetM: snapped };
}

/** A far-reaching pair of endpoints for rendering a guide as a long segment
 * (guides are conceptually infinite). */
export function guideDrawSpan(g: Guide, halfLenM = 100): [Vec3, Vec3] {
  const u = normalize(g.dir);
  return [add(g.origin, scale(u, -halfLenM)), add(g.origin, scale(u, halfLenM))];
}
