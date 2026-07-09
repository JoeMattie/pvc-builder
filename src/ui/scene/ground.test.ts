import type { Ray } from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../schema';
import { dominantAxisNormal, rayToGround, rayToPlane } from './ground';

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
