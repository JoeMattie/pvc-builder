import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../schema';
import {
  closestPointOnSegment,
  defaultSnapTolerances,
  type SnapContext,
  snapPoint,
} from './snapping';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const ctx = (over: Partial<SnapContext> = {}): SnapContext => ({
  nodes: [],
  segments: [],
  gridStepM: 0.1,
  pointRadiusM: 0.02,
  axisBandM: 0.03,
  ...over,
});

describe('closestPointOnSegment', () => {
  it('projects onto the interior', () => {
    expect(closestPointOnSegment(V(0.5, 1, 0), V(0, 0, 0), V(1, 0, 0))).toEqual(V(0.5, 0, 0));
  });
  it('clamps past the ends', () => {
    expect(closestPointOnSegment(V(-2, 1, 0), V(0, 0, 0), V(1, 0, 0))).toEqual(V(0, 0, 0));
    expect(closestPointOnSegment(V(9, 1, 0), V(0, 0, 0), V(1, 0, 0))).toEqual(V(1, 0, 0));
  });
});

describe('node snapping (highest priority)', () => {
  it('snaps to a nearby node and reports its id', () => {
    const r = snapPoint(V(0.505, 0, 0.5), ctx({ nodes: [{ id: 'n1', position: V(0.5, 0, 0.5) }] }));
    expect(r.kind).toBe('node');
    expect(r.nodeId).toBe('n1');
    expect(r.position).toEqual(V(0.5, 0, 0.5));
  });
  it('ignores a node outside the radius', () => {
    const r = snapPoint(V(1, 0, 0), ctx({ nodes: [{ id: 'n1', position: V(0.5, 0, 0.5) }] }));
    expect(r.kind).not.toBe('node');
  });
});

describe('on-pipe snapping', () => {
  it('snaps to the closest point on a segment', () => {
    const r = snapPoint(V(0.5, 0, 0.01), ctx({ segments: [{ a: V(0, 0, 0), b: V(1, 0, 0) }] }));
    expect(r.kind).toBe('on-pipe');
    expect(r.position.x).toBeCloseTo(0.5, 9);
    expect(r.position.z).toBeCloseTo(0, 9);
  });

  it('reports the hit segment member id (so a branch can wrap/split it)', () => {
    const r = snapPoint(
      V(0.5, 0, 0.01),
      ctx({ segments: [{ a: V(0, 0, 0), b: V(1, 0, 0), memberId: 'm7' }] }),
    );
    expect(r.kind).toBe('on-pipe');
    expect(r.onPipeMemberId).toBe('m7');
  });
});

describe('axis inference from the path start', () => {
  it('locks a near-axis cursor onto the X axis through fromNode', () => {
    // cursor drifting slightly off the +X ray from the origin
    const r = snapPoint(V(0.32, 0, 0.01), ctx({ fromNode: V(0, 0, 0), gridStepM: 0 }));
    expect(r.kind).toBe('axis-x');
    expect(r.position.z).toBeCloseTo(0, 9);
    expect(r.position.x).toBeCloseTo(0.32, 9);
    expect(r.guide).toEqual({ axis: 'x', from: V(0, 0, 0), to: r.position });
  });

  it('quantizes length along the axis to the grid step', () => {
    const r = snapPoint(V(0.34, 0, 0.01), ctx({ fromNode: V(0, 0, 0), gridStepM: 0.1 }));
    expect(r.kind).toBe('axis-x');
    expect(r.position.x).toBeCloseTo(0.3, 9); // 0.34 → nearest 0.1
  });

  it('picks the Z axis when the cursor runs along +Z', () => {
    const r = snapPoint(V(0.01, 0, 0.5), ctx({ fromNode: V(0, 0, 0), gridStepM: 0 }));
    expect(r.kind).toBe('axis-z');
    expect(r.position.x).toBeCloseTo(0, 9);
  });

  it('does not force an axis when the cursor is off-corridor', () => {
    const r = snapPoint(V(0.5, 0, 0.5), ctx({ fromNode: V(0, 0, 0), gridStepM: 0.1 }));
    expect(r.kind).toBe('grid');
  });
});

describe('grid snapping', () => {
  it('rounds to the nearest grid point when nothing else applies', () => {
    const r = snapPoint(V(0.44, 0, 0.56), ctx({ gridStepM: 0.1 }));
    expect(r.kind).toBe('grid');
    expect(r.position.x).toBeCloseTo(0.4, 9);
    expect(r.position.z).toBeCloseTo(0.6, 9);
  });
  it('returns the raw point when the grid is disabled', () => {
    const raw = V(0.123, 0, 0.456);
    const r = snapPoint(raw, ctx({ gridStepM: 0 }));
    expect(r.kind).toBe('free');
    expect(r.position).toEqual(raw);
  });
});

describe('defaultSnapTolerances', () => {
  it('uses a 1/4-inch grid', () => {
    expect(defaultSnapTolerances().gridStepM).toBeCloseTo(0.00635, 9);
  });
});
