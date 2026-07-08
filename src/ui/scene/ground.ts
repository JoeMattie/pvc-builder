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
