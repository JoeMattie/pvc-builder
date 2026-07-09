import type { Ray } from 'three';
import type { Vec3 } from '../../schema';

/** Intersect a picking ray with the ground plane y = 0. Returns null when the
 * ray is parallel to the ground or points away from it. Used for drawing and
 * endpoint dragging, which both live on the ground plane in Phase 1. */
export function rayToGround(ray: Ray): Vec3 | null {
  const { origin, direction } = ray;
  if (Math.abs(direction.y) < 1e-9) return null;
  const t = -origin.y / direction.y;
  if (t < 0) return null;
  return {
    x: origin.x + direction.x * t,
    y: 0,
    z: origin.z + direction.z * t,
  };
}

/** Intersect a picking ray with an arbitrary plane (point + unit normal).
 * Returns null when the ray is parallel to the plane or the hit is behind the
 * ray origin. Used for the Blender-style, view-aware endpoint drag so a floating
 * node isn't yanked down to y = 0. */
export function rayToPlane(ray: Ray, point: Vec3, normal: Vec3): Vec3 | null {
  const { origin, direction } = ray;
  const nd = direction.x * normal.x + direction.y * normal.y + direction.z * normal.z;
  if (Math.abs(nd) < 1e-9) return null;
  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const pz = point.z - origin.z;
  const t = (px * normal.x + py * normal.y + pz * normal.z) / nd;
  if (t < 0) return null;
  return {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  };
}

/** Closest point ON the segment a→b to a picking `ray`, plus that point's
 * perpendicular distance to the ray line. Lets the draw cursor snap onto a pipe
 * at ANY height — a ground raycast can't, since an elevated pipe is nowhere near
 * the y=0 hit point. `dist` is Infinity when the closest point is behind the
 * camera (t < 0). Pure; no three.js math beyond reading the ray's vectors. */
export function closestPointOnSegmentToRay(
  ray: Ray,
  a: Vec3,
  b: Vec3,
): { point: Vec3; dist: number } {
  const o = ray.origin;
  const v = ray.direction; // unit
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const wx = a.x - o.x;
  const wy = a.y - o.y;
  const wz = a.z - o.z;
  const A = ux * ux + uy * uy + uz * uz; // |segment|²
  const B = ux * v.x + uy * v.y + uz * v.z;
  const C = v.x * v.x + v.y * v.y + v.z * v.z; // |dir|² (≈1)
  const D = ux * wx + uy * wy + uz * wz;
  const E = v.x * wx + v.y * wy + v.z * wz;
  const denom = A * C - B * B;
  let s = denom > 1e-12 ? (B * E - C * D) / denom : 0; // param along the segment
  s = Math.max(0, Math.min(1, s));
  const point = { x: a.x + ux * s, y: a.y + uy * s, z: a.z + uz * s };
  const t = ((point.x - o.x) * v.x + (point.y - o.y) * v.y + (point.z - o.z) * v.z) / C;
  if (t < 0) return { point, dist: Number.POSITIVE_INFINITY }; // behind the camera
  const cx = o.x + v.x * t;
  const cy = o.y + v.y * t;
  const cz = o.z + v.z * t;
  return { point, dist: Math.hypot(point.x - cx, point.y - cy, point.z - cz) };
}

/** The world axis (X/Y/Z) most aligned with the camera's view direction, used
 * as the drag-plane normal so a free move slides in the plane facing the camera
 * (Blender-style context-awareness). A small bias toward Y makes near-ties
 * resolve to the horizontal plane, so the common iso / top-down views (where the
 * three axes are near-equally facing) drag horizontally through the node —
 * preserving its height instead of dropping it to the floor. Only when the view
 * is clearly low/horizontal (a front or side view) does a vertical plane win, so
 * the node can be moved up and down there. */
const Y_BIAS = 0.05;
export function dominantAxisNormal(forward: Vec3): Vec3 {
  const ax = Math.abs(forward.x);
  const ay = Math.abs(forward.y) + Y_BIAS;
  const az = Math.abs(forward.z);
  if (ay >= ax && ay >= az) return { x: 0, y: 1, z: 0 };
  if (ax >= az) return { x: 1, y: 0, z: 0 };
  return { x: 0, y: 0, z: 1 };
}
