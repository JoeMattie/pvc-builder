import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../schema';
import { lockToNearestAxis, projectLengthOnAxis } from './dragMath';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const X: Vec3 = V(1, 0, 0);

describe('projectLengthOnAxis (length arrows)', () => {
  it('sets the length to the cursor projection, grid-quantized', () => {
    const r = projectLengthOnAxis(V(0, 0, 0), X, V(0.31, 0, 0.05), 0.0254, 0.0254);
    expect(r.lengthM).toBeCloseTo(0.3048, 9); // 0.31 → 12" grid
    expect(r.position.x).toBeCloseTo(0.3048, 9);
    expect(r.position.z).toBeCloseTo(0, 9);
  });

  it('ignores the perpendicular offset (stays on the axis)', () => {
    const r = projectLengthOnAxis(V(0, 0, 0), X, V(0.5, 0, 5), 0, 0.01);
    expect(r.position.z).toBe(0);
    expect(r.lengthM).toBeCloseTo(0.5, 9);
  });

  it('clamps to the minimum length instead of collapsing/flipping', () => {
    const r = projectLengthOnAxis(V(0, 0, 0), X, V(-2, 0, 0), 0, 0.0254);
    expect(r.lengthM).toBe(0.0254);
    expect(r.position).toEqual(V(0.0254, 0, 0));
  });

  it('measures along a diagonal axis', () => {
    const dir = V(0.6, 0, 0.8); // unit
    const r = projectLengthOnAxis(V(0, 0, 0), dir, V(0.6, 0, 0.8), 0, 0.01);
    expect(r.lengthM).toBeCloseTo(1, 9);
  });
});

describe('lockToNearestAxis (Shift)', () => {
  it('locks to X when the drag runs mostly along X', () => {
    const r = lockToNearestAxis(V(0, 0, 0), V(0.31, 0, 0.05), 0.0254);
    expect(r.axis).toBe('x');
    expect(r.position.x).toBeCloseTo(0.3048, 9);
    expect(r.position.z).toBeCloseTo(0, 9);
  });

  it('locks to Z when the drag runs mostly along Z', () => {
    const r = lockToNearestAxis(V(1, 0, 1), V(1.05, 0, 1.4), 0);
    expect(r.axis).toBe('z');
    expect(r.position).toEqual(V(1, 0, 1.4));
  });

  it('anchors the lock at the drag-start point', () => {
    const r = lockToNearestAxis(V(2, 0, 0), V(2.5, 0, 0.02), 0);
    expect(r.position).toEqual(V(2.5, 0, 0));
  });
});
