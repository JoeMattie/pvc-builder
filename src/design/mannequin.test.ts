import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../schema';
import { MANNEQUIN_ANCHORS, type MannequinShape, mannequinShapes } from './mannequin';

/** Every point that a shape spans (for a crude AABB of the whole mannequin). */
function shapePoints(s: MannequinShape): Vec3[] {
  if (s.kind === 'sphere')
    return [
      { x: s.center.x - s.r, y: s.center.y - s.r, z: s.center.z - s.r },
      { x: s.center.x + s.r, y: s.center.y + s.r, z: s.center.z + s.r },
    ];
  if (s.kind === 'box')
    return [
      { x: s.center.x - s.half.x, y: s.center.y - s.half.y, z: s.center.z - s.half.z },
      { x: s.center.x + s.half.x, y: s.center.y + s.half.y, z: s.center.z + s.half.z },
    ];
  // capsule: both endpoints ± radius
  return [
    { x: s.a.x - s.r, y: s.a.y - s.r, z: s.a.z - s.r },
    { x: s.a.x + s.r, y: s.a.y + s.r, z: s.a.z + s.r },
    { x: s.b.x - s.r, y: s.b.y - s.r, z: s.b.z - s.r },
    { x: s.b.x + s.r, y: s.b.y + s.r, z: s.b.z + s.r },
  ];
}

describe('mannequinShapes', () => {
  const shapes = mannequinShapes();

  it('returns a non-empty set of primitives with a head, torso, and limbs', () => {
    expect(shapes.length).toBeGreaterThanOrEqual(8);
    expect(shapes.filter((s) => s.kind === 'sphere')).toHaveLength(1); // head
    expect(shapes.filter((s) => s.kind === 'capsule').length).toBeGreaterThanOrEqual(4); // arms + legs + bar
    expect(shapes.filter((s) => s.kind === 'box').length).toBeGreaterThanOrEqual(1); // torso
  });

  it('is bounded to a ~1.75 m standing human at the origin', () => {
    const pts = shapes.flatMap(shapePoints);
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const maxAbsX = Math.max(...pts.map((p) => Math.abs(p.x)));
    const maxAbsZ = Math.max(...pts.map((p) => Math.abs(p.z)));
    expect(minY).toBeGreaterThanOrEqual(-0.05); // feet on the ground
    expect(maxY).toBeGreaterThan(1.5); // reaches head height
    expect(maxY).toBeLessThanOrEqual(1.8); // not taller than ~1.75 m
    expect(maxAbsX).toBeLessThan(0.4); // shoulder-width, not sprawling
    expect(maxAbsZ).toBeLessThan(0.5);
  });

  it('exposes anchor points that match the shared coordinate contract', () => {
    expect(MANNEQUIN_ANCHORS.shoulderY).toBe(1.45);
    expect(MANNEQUIN_ANCHORS.hipY).toBe(1.0);
    expect(MANNEQUIN_ANCHORS.headCenterY).toBe(1.62);
    expect(MANNEQUIN_ANCHORS.headR).toBe(0.1);
    expect(MANNEQUIN_ANCHORS.shoulderHalfX).toBe(0.23);
    expect(MANNEQUIN_ANCHORS.hipPivotX).toBe(0.2);
    // saddles at (±0.23, 1.45, 0)
    expect(MANNEQUIN_ANCHORS.shoulderSaddleR).toEqual({ x: 0.23, y: 1.45, z: 0 });
    expect(MANNEQUIN_ANCHORS.shoulderSaddleL).toEqual({ x: -0.23, y: 1.45, z: 0 });
    // hip pivots (seesaw fulcrum) at (±0.20, 1.00, 0)
    expect(MANNEQUIN_ANCHORS.hipPivotR).toEqual({ x: 0.2, y: 1.0, z: 0 });
    // neck root front rail, tail root back rail
    expect(MANNEQUIN_ANCHORS.neckRoot).toEqual({ x: 0, y: 1.0, z: -0.45 });
    expect(MANNEQUIN_ANCHORS.tailRoot).toEqual({ x: 0, y: 1.0, z: 0.45 });
  });

  it('places the head sphere at the contract centre + radius', () => {
    const head = shapes.find((s) => s.kind === 'sphere');
    expect(head).toBeDefined();
    if (head?.kind === 'sphere') {
      expect(head.center).toEqual({ x: 0, y: 1.62, z: 0 });
      expect(head.r).toBe(0.1);
    }
  });
});
