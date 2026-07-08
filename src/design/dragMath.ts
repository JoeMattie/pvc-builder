// Pure math for the two direct-manipulation drags (planfile §1 "freely
// adjustable dimensions"): resizing a pipe along its own axis (the length
// arrows) and axis-locked free moves (Shift). No three.js / UI types.
import { add, dot, scale, sub } from '../geometry/math3';
import type { Vec3 } from '../schema';

function roundTo(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

/** Project the cursor onto the ray from `fixedEnd` along `axisDir` (a unit
 * vector pointing toward the moving end) and return the moving end's new
 * position + the resulting length. The length is grid-quantized and clamped to
 * `minLenM` so a pipe can't collapse or flip through its anchor. */
export function projectLengthOnAxis(
  fixedEnd: Vec3,
  axisDir: Vec3,
  cursor: Vec3,
  gridStepM: number,
  minLenM: number,
): { lengthM: number; position: Vec3 } {
  const raw = dot(sub(cursor, fixedEnd), axisDir);
  const lengthM = Math.max(minLenM, roundTo(raw, gridStepM));
  return { lengthM, position: add(fixedEnd, scale(axisDir, lengthM)) };
}

/** Length-arrow drag with a grab offset. The arrow head sits OUTWARD from the
 * pipe end, so the cursor grabs it at projection `grabProj` (along `axisDir`
 * from `fixedEnd`) while the pipe is `startLenM` long. As the cursor moves, the
 * length changes by the *delta* in projection, not the absolute projection — so
 * the first move doesn't jump the length out to the arrow's offset. The result
 * is grid-quantized and clamped to `minLenM`. */
export function lengthFromGrabDrag(
  fixedEnd: Vec3,
  axisDir: Vec3,
  cursor: Vec3,
  startLenM: number,
  grabProj: number,
  gridStepM: number,
  minLenM: number,
): { lengthM: number; position: Vec3 } {
  const proj = dot(sub(cursor, fixedEnd), axisDir);
  const lengthM = Math.max(minLenM, roundTo(startLenM + (proj - grabProj), gridStepM));
  return { lengthM, position: add(fixedEnd, scale(axisDir, lengthM)) };
}

/** The point on the infinite line `origin + t·axisDir` closest to the picking
 * ray `rayOrigin + s·rayDir`. Used by the move-tool axis arrows: the cursor's
 * projection onto a world axis, which works for the vertical (Y) axis too — a
 * ground raycast can't. Falls back to `origin` when the ray is parallel to the
 * axis. */
export function closestAxisPointToRay(
  origin: Vec3,
  axisDir: Vec3,
  rayOrigin: Vec3,
  rayDir: Vec3,
): Vec3 {
  const w0 = sub(origin, rayOrigin);
  const a = dot(axisDir, axisDir);
  const b = dot(axisDir, rayDir);
  const c = dot(rayDir, rayDir);
  const d = dot(axisDir, w0);
  const e = dot(rayDir, w0);
  const denom = a * c - b * b;
  const t = Math.abs(denom) < 1e-12 ? 0 : (b * e - c * d) / denom;
  return add(origin, scale(axisDir, t));
}

const AXES: Array<{ key: 'x' | 'y' | 'z'; dir: Vec3 }> = [
  { key: 'x', dir: { x: 1, y: 0, z: 0 } },
  { key: 'y', dir: { x: 0, y: 1, z: 0 } },
  { key: 'z', dir: { x: 0, y: 0, z: 1 } },
];

/** Lock a free move to whichever world axis the drag runs most along (Shift):
 * project (cursor − anchor) onto that axis, grid-quantized. `anchor` is the
 * moving point's position when the drag began. */
export function lockToNearestAxis(
  anchor: Vec3,
  cursor: Vec3,
  gridStepM: number,
): { position: Vec3; axis: 'x' | 'y' | 'z' } {
  const rel = sub(cursor, anchor);
  let best = AXES[0]!;
  let bestAbs = -1;
  for (const ax of AXES) {
    const a = Math.abs(dot(rel, ax.dir));
    if (a > bestAbs) {
      bestAbs = a;
      best = ax;
    }
  }
  const t = roundTo(dot(rel, best.dir), gridStepM);
  return { position: add(anchor, scale(best.dir, t)), axis: best.key };
}
