import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../schema';
import {
  axisOffsetGuideOrigin,
  type Guide,
  guideIntersections,
  perpOffsetM,
  perpUnit,
  snapDirToAxis,
} from './guides';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describe('snapDirToAxis', () => {
  it('snaps a near-X direction to +X', () => {
    expect(snapDirToAxis(V(0.9, 0.1, 0.05))).toEqual(V(1, 0, 0));
  });
  it('snaps a near-Z direction to +Z (sign-normalised)', () => {
    expect(snapDirToAxis(V(0.1, 0, -0.95))).toEqual(V(0, 0, 1));
  });
});

describe('guideIntersections', () => {
  it('finds where an axis guide crosses a perpendicular pipe', () => {
    // pipe along X from (-1,0,0) to (1,0,0); guide along Z through (0.3,0,0)
    const guide: Guide = { id: 'g', origin: V(0.3, 0, 0), dir: V(0, 0, 1) };
    const hits = guideIntersections([guide], [{ a: V(-1, 0, 0), b: V(1, 0, 0) }]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.x).toBeCloseTo(0.3, 6);
    expect(hits[0]!.z).toBeCloseTo(0, 6);
  });

  it('ignores a guide that misses the pipe (out of plane)', () => {
    // guide along Z but at y=0.5, pipe at y=0 → they never meet
    const guide: Guide = { id: 'g', origin: V(0.3, 0.5, 0), dir: V(0, 0, 1) };
    const hits = guideIntersections([guide], [{ a: V(-1, 0, 0), b: V(1, 0, 0) }]);
    expect(hits).toHaveLength(0);
  });

  it('ignores a crossing that falls beyond the segment ends', () => {
    // guide along Z through x=5 (past the pipe which spans x∈[-1,1])
    const guide: Guide = { id: 'g', origin: V(5, 0, 0), dir: V(0, 0, 1) };
    const hits = guideIntersections([guide], [{ a: V(-1, 0, 0), b: V(1, 0, 0) }]);
    expect(hits).toHaveLength(0);
  });
});

describe('axisOffsetGuideOrigin (pure-axis placement)', () => {
  it('constrains a diagonal ground cursor to the dominant perpendicular axis', () => {
    // guide along X picked at (0, 0.5, 0); cursor drifted to the ground plane
    // (y=0) mostly along +Z → the guide must offset in pure Z at the pipe's y
    const { origin, axis } = axisOffsetGuideOrigin(V(0, 0.5, 0), V(1, 0, 0), V(0.7, 0, 0.6));
    expect(axis).toEqual(V(0, 0, 1));
    expect(origin).toEqual(V(0, 0.5, 0.6));
  });

  it('offsets vertically when the cursor moves most in Y', () => {
    const { origin, axis } = axisOffsetGuideOrigin(V(0, 0.5, 0), V(1, 0, 0), V(0.2, 1.4, 0.1));
    expect(axis).toEqual(V(0, 1, 0));
    expect(origin).toEqual(V(0, 1.4, 0));
  });

  it('grid-snaps the offset and keeps its sign', () => {
    const g = axisOffsetGuideOrigin(V(0, 0, 0), V(1, 0, 0), V(0, 0, -0.26), 0.25);
    expect(g.offsetM).toBeCloseTo(-0.25, 9);
    expect(g.origin.z).toBeCloseTo(-0.25, 9);
  });

  it('a constrained guide still intersects the picked pipe exactly', () => {
    // pipe along X at y=0.5; guide placed off a ground-tracking cursor
    const { origin } = axisOffsetGuideOrigin(V(0.3, 0.5, 0), V(0, 0, 1), V(0.9, 0, 0.2));
    const hits = guideIntersections(
      [{ id: 'g', origin, dir: V(0, 0, 1) }],
      [{ a: V(-1, 0.5, 0), b: V(1, 0.5, 0) }],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.y).toBeCloseTo(0.5, 6);
  });
});

describe('perpOffset / perpUnit', () => {
  it('measures the perpendicular distance from the reference line', () => {
    // reference line along X through origin; point 0.4 away in Z
    expect(perpOffsetM(V(0, 0, 0), V(1, 0, 0), V(2, 0, 0.4))).toBeCloseTo(0.4, 9);
  });
  it('perpUnit points away from the line, null when on it', () => {
    expect(perpUnit(V(0, 0, 0), V(1, 0, 0), V(2, 0, 0.4))).toEqual(V(0, 0, 1));
    expect(perpUnit(V(0, 0, 0), V(1, 0, 0), V(3, 0, 0))).toBeNull();
  });
});
