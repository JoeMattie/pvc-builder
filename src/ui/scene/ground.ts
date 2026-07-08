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
