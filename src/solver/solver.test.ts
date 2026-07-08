import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import { solve } from './index';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const at = (r: { nodePositions: Record<string, Vec3> }, id: string): Vec3 => r.nodePositions[id]!;

/** a-(ma)-mid-(mb)-end along +X, with a vertical-axis pivot at `mid`. Root
 * body = ma (fixed); mb rotates about Y through (1,0,0). */
function singlePivot(angleRad?: number): Design {
  const d = createEmptyDesign('d', 'pivot');
  d.nodes.push(
    { id: 'a', position: V(0, 0, 0) },
    { id: 'mid', position: V(1, 0, 0) },
    { id: 'end', position: V(2, 0, 0) },
  );
  d.members.push(
    { id: 'ma', kind: 'straight', nodeA: 'a', nodeB: 'mid', size: '3/4"' },
    { id: 'mb', kind: 'straight', nodeA: 'mid', nodeB: 'end', size: '3/4"' },
  );
  d.pivots.push({
    id: 'p1',
    nodeId: 'mid',
    memberA: 'ma',
    memberB: 'mb',
    axis: V(0, 1, 0),
    angleRad,
  });
  return d;
}

describe('solve — unlocked (not physics)', () => {
  it('returns node positions unchanged', () => {
    const d = singlePivot();
    const r = solve(d, { lengthsLocked: false, pivotAngles: { p1: 1 } }, 'pose');
    expect(at(r, 'end')).toEqual(V(2, 0, 0));
  });
});

describe('solve — single pivot (locked)', () => {
  it('the end traces a circular arc of fixed radius about the axis', () => {
    const d = singlePivot();
    for (const theta of [0, Math.PI / 6, Math.PI / 2, (2 * Math.PI) / 3, Math.PI]) {
      const r = solve(d, { lengthsLocked: true, pivotAngles: { p1: theta } }, 'pose');
      // analytic: end = (1 + cosθ, 0, −sinθ), radius 1 about (1,0,0)
      expect(at(r, 'end').x).toBeCloseTo(1 + Math.cos(theta), 9);
      expect(at(r, 'end').z).toBeCloseTo(-Math.sin(theta), 9);
      expect(dist(at(r, 'end'), V(1, 0, 0))).toBeCloseTo(1, 9);
      // the pivot node and the fixed member never move
      expect(at(r, 'mid')).toEqual(V(1, 0, 0));
      expect(at(r, 'a')).toEqual(V(0, 0, 0));
    }
  });

  it('the slider angle sets the pose to the analytic position', () => {
    const r = solve(
      singlePivot(),
      { lengthsLocked: true, pivotAngles: { p1: Math.PI / 2 } },
      'pose',
    );
    expect(at(r, 'end').x).toBeCloseTo(1, 9);
    expect(at(r, 'end').z).toBeCloseTo(-1, 9);
  });

  it('preserves every member length exactly at any angle', () => {
    const r = solve(singlePivot(), { lengthsLocked: true, pivotAngles: { p1: 1.234 } }, 'pose');
    expect(dist(at(r, 'a'), at(r, 'mid'))).toBeCloseTo(1, 12);
    expect(dist(at(r, 'mid'), at(r, 'end'))).toBeCloseTo(1, 12);
  });

  it('reports mobility 1 (a one-DOF mechanism)', () => {
    const r = solve(singlePivot(), { lengthsLocked: true, pivotAngles: {} }, 'pose');
    expect(r.diagnostics.mobilityDof).toBe(1);
    expect(r.diagnostics.overConstrained).toBe(false);
  });
});

describe('solve — drag (locked)', () => {
  it('rotates the pivot to follow the drag, preserving all lengths', () => {
    const d = singlePivot();
    // drag the end toward an off-circle target; IK lands on the reachable circle
    const r = solve(
      d,
      {
        lengthsLocked: true,
        pivotAngles: { p1: 0 },
        dragTarget: { nodeId: 'end', position: V(1.4, 0, -0.9) },
      },
      'pose',
    );
    expect(dist(at(r, 'a'), at(r, 'mid'))).toBeCloseTo(1, 6);
    expect(dist(at(r, 'mid'), at(r, 'end'))).toBeCloseTo(1, 6);
    // the end stays on its circle (radius 1 about the pivot)
    expect(dist(at(r, 'end'), V(1, 0, 0))).toBeCloseTo(1, 6);
    // and moves toward the drag target (negative z, like the target)
    expect(at(r, 'end').z).toBeLessThan(0);
  });

  it('reaches an on-circle target and writes the angle back', () => {
    const r = solve(
      singlePivot(),
      {
        lengthsLocked: true,
        pivotAngles: { p1: 0 },
        dragTarget: { nodeId: 'end', position: V(1, 0, -1) },
      },
      'pose',
    );
    expect(dist(at(r, 'end'), V(1, 0, -1))).toBeCloseTo(0, 5);
    expect(r.pivotAngles.p1).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('solve — multi-pivot chain', () => {
  function chain(): Design {
    const d = createEmptyDesign('d', 'chain');
    d.nodes.push(
      { id: 'n0', position: V(0, 0, 0) },
      { id: 'n1', position: V(1, 0, 0) },
      { id: 'n2', position: V(2, 0, 0) },
      { id: 'n3', position: V(3, 0, 0) },
    );
    d.members.push(
      { id: 'm0', kind: 'straight', nodeA: 'n0', nodeB: 'n1', size: '3/4"' },
      { id: 'm1', kind: 'straight', nodeA: 'n1', nodeB: 'n2', size: '3/4"' },
      { id: 'm2', kind: 'straight', nodeA: 'n2', nodeB: 'n3', size: '3/4"' },
    );
    d.pivots.push(
      { id: 'pa', nodeId: 'n1', memberA: 'm0', memberB: 'm1', axis: V(0, 1, 0) },
      { id: 'pb', nodeId: 'n2', memberA: 'm1', memberB: 'm2', axis: V(0, 1, 0) },
    );
    return d;
  }

  it('composes pivot rotations and preserves every length; mobility 2', () => {
    const d = chain();
    const r = solve(
      d,
      { lengthsLocked: true, pivotAngles: { pa: Math.PI / 2, pb: Math.PI / 2 } },
      'pose',
    );
    expect(dist(at(r, 'n0'), at(r, 'n1'))).toBeCloseTo(1, 12);
    expect(dist(at(r, 'n1'), at(r, 'n2'))).toBeCloseTo(1, 12);
    expect(dist(at(r, 'n2'), at(r, 'n3'))).toBeCloseTo(1, 12);
    expect(r.diagnostics.mobilityDof).toBe(2);
  });
});

describe('solve — determinism & rigidity', () => {
  it('is reproducible for identical inputs', () => {
    const d = singlePivot();
    const inputs = { lengthsLocked: true, pivotAngles: { p1: 0.7 } } as const;
    expect(solve(d, inputs, 'pose')).toEqual(solve(d, inputs, 'pose'));
  });

  it('reports mobility 0 for a welded (pivot-free) assembly', () => {
    const d = createEmptyDesign('d', 'rigid');
    d.nodes.push(
      { id: 'a', position: V(0, 0, 0) },
      { id: 'b', position: V(1, 0, 0) },
      { id: 'c', position: V(1, 0, 1) },
    );
    d.members.push(
      { id: 'm0', kind: 'straight', nodeA: 'a', nodeB: 'b', size: '3/4"' },
      { id: 'm1', kind: 'straight', nodeA: 'b', nodeB: 'c', size: '3/4"' },
    );
    const r = solve(d, { lengthsLocked: true, pivotAngles: {} }, 'pose');
    expect(r.diagnostics.mobilityDof).toBe(0);
  });
});
