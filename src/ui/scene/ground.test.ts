import type { Ray } from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../schema';
import {
  closestPointOnSegmentToRay,
  dominantAxisNormal,
  rayToGround,
  rayToPlane,
} from './ground';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
// a minimal Ray-shaped object (rayToGround/rayToPlane only read origin/direction)
const ray = (origin: Vec3, direction: Vec3): Ray => ({ origin, direction }) as unknown as Ray;

describe('rayToGround', () => {
  it('hits y = 0 straight down', () => {
    expect(rayToGround(ray(V(1, 2, 3), V(0, -1, 0)))).toEqual(V(1, 0, 3));
  });
  it('returns null for a ray parallel to the ground', () => {
    expect(rayToGround(ray(V(0, 1, 0), V(1, 0, 0)))).toBeNull();
  });
});

describe('rayToPlane', () => {
  it('hits a raised horizontal plane through a floating point (no drop to y=0)', () => {
    // straight-down ray onto the plane y = 0.3 through the node
    const hit = rayToPlane(ray(V(1, 5, 3), V(0, -1, 0)), V(1, 0.3, 3), V(0, 1, 0));
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(0.3, 9);
    expect(hit!.x).toBeCloseTo(1, 9);
  });
  it('hits a vertical plane (front view) so the node can move up/down', () => {
    // plane with +Z normal through the node; ray comes along -Z from a raised eye
    const hit = rayToPlane(ray(V(0.2, 0.5, 4), V(0, 0, -1)), V(0, 0, 0), V(0, 0, 1));
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(0, 9);
    expect(hit!.y).toBeCloseTo(0.5, 9); // vertical motion preserved
  });
  it('returns null when the ray is parallel to the plane', () => {
    expect(rayToPlane(ray(V(0, 1, 0), V(1, 0, 0)), V(0, 0, 0), V(0, 1, 0))).toBeNull();
  });
});

describe('dominantAxisNormal (view-aware drag plane)', () => {
  it('top-down / iso views pick the horizontal (Y) plane', () => {
    expect(dominantAxisNormal(V(0, -1, 0))).toEqual(V(0, 1, 0)); // top-down
    expect(dominantAxisNormal(V(-1, -1, -1))).toEqual(V(0, 1, 0)); // iso — Y tie-break
  });
  it('a front view picks the Z plane (vertical, allows up/down)', () => {
    expect(dominantAxisNormal(V(0.1, -0.2, -0.97))).toEqual(V(0, 0, 1));
  });
  it('a side view picks the X plane', () => {
    expect(dominantAxisNormal(V(0.97, -0.2, 0.1))).toEqual(V(1, 0, 0));
  });
});

describe('closestPointOnSegmentToRay (draw-snap onto pipes at any height)', () => {
  // an ELEVATED pipe from (-1,1,0) to (1,1,0); a ray straight down onto its middle
  it('finds the point on a raised pipe a downward ray passes through', () => {
    const r = closestPointOnSegmentToRay(ray(V(0, 5, 0), V(0, -1, 0)), V(-1, 1, 0), V(1, 1, 0));
    expect(r.dist).toBeCloseTo(0, 6); // the ray passes through the pipe
    expect(r.point.x).toBeCloseTo(0, 6);
    expect(r.point.y).toBeCloseTo(1, 6); // ON the pipe at its real height, not y=0
  });

  it('reports the perpendicular miss distance when the ray is off the pipe', () => {
    // ray down at x=0.5 offset from a pipe along X at (…,1,0); closest point is on it
    const r = closestPointOnSegmentToRay(ray(V(0, 5, 0.2), V(0, -1, 0)), V(-1, 1, 0), V(1, 1, 0));
    expect(r.dist).toBeCloseTo(0.2, 6);
    expect(r.point.z).toBeCloseTo(0, 6);
  });

  it('clamps to the nearer endpoint past the segment end', () => {
    const r = closestPointOnSegmentToRay(ray(V(5, 5, 0), V(0, -1, 0)), V(-1, 1, 0), V(1, 1, 0));
    expect(r.point.x).toBeCloseTo(1, 6); // clamped to the b endpoint
  });

  it('returns Infinity distance when the pipe is behind the camera', () => {
    // ray points +Y (up); the pipe at y=1 is behind an eye at y=5 looking up
    const r = closestPointOnSegmentToRay(ray(V(0, 5, 0), V(0, 1, 0)), V(-1, 1, 0), V(1, 1, 0));
    expect(r.dist).toBe(Number.POSITIVE_INFINITY);
  });
});
