import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Joint, type Vec3 } from '../schema';
import { solve } from './index';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const at = (r: { nodePositions: Record<string, Vec3> }, id: string): Vec3 => r.nodePositions[id]!;

/** An L: a-(ma along +X)-mid-(mb along +Z)-end, with a WRAPPED pivot at `mid`.
 * The mover mb swivels about the receiver ma's own axis (+X). Root body = ma
 * (fixed); the end traces a circle in the plane perpendicular to ma. */
function wrappedL(angleRad?: number): Design {
  const d = createEmptyDesign('d', 'wrapped pivot');
  d.nodes.push(
    { id: 'a', position: V(0, 0, 0) },
    { id: 'mid', position: V(1, 0, 0) },
    { id: 'end', position: V(1, 0, 1) },
  );
  d.members.push(
    { id: 'ma', kind: 'straight', nodeA: 'a', nodeB: 'mid', size: '3/4"' },
    { id: 'mb', kind: 'straight', nodeA: 'mid', nodeB: 'end', size: '3/4"' },
  );
  const j: Joint = {
    id: 'p1',
    nodeId: 'mid',
    receiver: 'ma',
    mover: 'mb',
    onBody: false,
    mode: 'wrapped',
    angleRad,
  };
  d.joints.push(j);
  return d;
}

describe('solve — unlocked (not physics)', () => {
  it('returns node positions unchanged', () => {
    const d = wrappedL();
    const r = solve(d, { lengthsLocked: false, pivotAngles: { p1: 1 } }, 'pose');
    expect(at(r, 'end')).toEqual(V(1, 0, 1));
  });
});

describe('solve — single wrapped pivot (locked)', () => {
  it('the end traces a fixed-radius arc about the receiver axis', () => {
    const d = wrappedL();
    for (const theta of [0, Math.PI / 6, Math.PI / 2, (2 * Math.PI) / 3, Math.PI]) {
      const r = solve(d, { lengthsLocked: true, pivotAngles: { p1: theta } }, 'pose');
      // analytic: mover swivels about +X, so end = (1, sinθ, cosθ), x fixed
      expect(at(r, 'end').x).toBeCloseTo(1, 9);
      expect(at(r, 'end').y).toBeCloseTo(Math.sin(theta), 9);
      expect(at(r, 'end').z).toBeCloseTo(Math.cos(theta), 9);
      expect(dist(at(r, 'end'), V(1, 0, 0))).toBeCloseTo(1, 9);
      // the pivot node and the fixed member never move
      expect(at(r, 'mid')).toEqual(V(1, 0, 0));
      expect(at(r, 'a')).toEqual(V(0, 0, 0));
    }
  });

  it('the slider angle sets the pose to the analytic position', () => {
    const r = solve(wrappedL(), { lengthsLocked: true, pivotAngles: { p1: Math.PI / 2 } }, 'pose');
    expect(at(r, 'end').x).toBeCloseTo(1, 9);
    expect(at(r, 'end').y).toBeCloseTo(1, 9);
    expect(at(r, 'end').z).toBeCloseTo(0, 9);
  });

  it('preserves every member length exactly at any angle', () => {
    const r = solve(wrappedL(), { lengthsLocked: true, pivotAngles: { p1: 1.234 } }, 'pose');
    expect(dist(at(r, 'a'), at(r, 'mid'))).toBeCloseTo(1, 12);
    expect(dist(at(r, 'mid'), at(r, 'end'))).toBeCloseTo(1, 12);
  });

  it('reports mobility 1 (a one-DOF revolute mechanism)', () => {
    const r = solve(wrappedL(), { lengthsLocked: true, pivotAngles: {} }, 'pose');
    expect(r.diagnostics.mobilityDof).toBe(1);
    expect(r.diagnostics.overConstrained).toBe(false);
  });

  it('drag rotates the pivot to follow, preserving all lengths', () => {
    const r = solve(
      wrappedL(),
      {
        lengthsLocked: true,
        pivotAngles: { p1: 0 },
        dragTarget: { nodeId: 'end', position: V(1, 0.9, 0.2) },
      },
      'pose',
    );
    expect(dist(at(r, 'a'), at(r, 'mid'))).toBeCloseTo(1, 6);
    expect(dist(at(r, 'mid'), at(r, 'end'))).toBeCloseTo(1, 6);
    // the end stays on its circle (radius 1 about the pivot, x fixed)
    expect(dist(at(r, 'end'), V(1, 0, 0))).toBeCloseTo(1, 6);
    expect(at(r, 'end').y).toBeGreaterThan(0);
  });
});

describe('solve — single free (ball) pivot (locked)', () => {
  /** a-(ma)-mid-(mb)-end straight along +X, with a FREE ball joint at mid. */
  function freeBall(): Design {
    const d = createEmptyDesign('d', 'free pivot');
    d.nodes.push(
      { id: 'a', position: V(0, 0, 0) },
      { id: 'mid', position: V(1, 0, 0) },
      { id: 'end', position: V(2, 0, 0) },
    );
    d.members.push(
      { id: 'ma', kind: 'straight', nodeA: 'a', nodeB: 'mid', size: '3/4"' },
      { id: 'mb', kind: 'straight', nodeA: 'mid', nodeB: 'end', size: '3/4"' },
    );
    d.joints.push({
      id: 'f1',
      nodeId: 'mid',
      receiver: 'ma',
      mover: 'mb',
      onBody: false,
      mode: 'free',
    });
    return d;
  }

  it('reports mobility 3 (a spherical joint)', () => {
    const r = solve(freeBall(), { lengthsLocked: true, pivotAngles: {} }, 'pose');
    expect(r.diagnostics.mobilityDof).toBe(3);
    expect(r.diagnostics.overConstrained).toBe(false);
  });

  it('drag reaches an on-sphere target in any direction, lengths preserved', () => {
    const r = solve(
      freeBall(),
      {
        lengthsLocked: true,
        pivotAngles: {},
        dragTarget: { nodeId: 'end', position: V(1, 1, 0) },
      },
      'pose',
    );
    expect(dist(at(r, 'end'), V(1, 1, 0))).toBeCloseTo(0, 5);
    expect(dist(at(r, 'a'), at(r, 'mid'))).toBeCloseTo(1, 9);
    expect(dist(at(r, 'mid'), at(r, 'end'))).toBeCloseTo(1, 9);
  });

  it('an on-body free branch is a 3-DOF ball joint, lengths preserved under drag', () => {
    // a run m0 with a branch m1 ball-jointed onto its span at n3
    const d = createEmptyDesign('d', 'on-body free');
    d.nodes.push(
      { id: 'n0', position: V(0, 0, 0) },
      { id: 'n1', position: V(1, 0, 0) },
      { id: 'n2', position: V(0.5, 0, 0.5) },
      { id: 'n3', position: V(0.5, 0, 0) }, // on the run span
    );
    d.members.push(
      { id: 'm0', kind: 'straight', nodeA: 'n0', nodeB: 'n1', size: '3/4"' },
      { id: 'm1', kind: 'straight', nodeA: 'n2', nodeB: 'n3', size: '3/4"' },
    );
    d.joints.push({
      id: 'f',
      nodeId: 'n3',
      receiver: 'm0',
      mover: 'm1',
      onBody: true,
      mode: 'free',
    });
    const r = solve(
      d,
      {
        lengthsLocked: true,
        pivotAngles: {},
        dragTarget: { nodeId: 'n2', position: V(0.5, 0.5, 0) },
      },
      'pose',
    );
    expect(r.diagnostics.mobilityDof).toBe(3);
    expect(dist(at(r, 'n2'), at(r, 'n3'))).toBeCloseTo(0.5, 6); // branch length held
    expect(dist(at(r, 'n2'), V(0.5, 0.5, 0))).toBeCloseTo(0, 5); // reached the target
  });

  it('drag to an off-sphere target lands on the sphere, lengths preserved', () => {
    const r = solve(
      freeBall(),
      {
        lengthsLocked: true,
        pivotAngles: {},
        dragTarget: { nodeId: 'end', position: V(1, 0, 3) },
      },
      'pose',
    );
    // stays on the unit sphere about the pivot and reaches toward +Z
    expect(dist(at(r, 'end'), V(1, 0, 0))).toBeCloseTo(1, 6);
    expect(at(r, 'end').z).toBeGreaterThan(0.9);
    expect(dist(at(r, 'mid'), at(r, 'end'))).toBeCloseTo(1, 9);
  });
});

describe('solve — multi-pivot chain', () => {
  /** a zig-zag so each mover is perpendicular to its receiver (non-degenerate):
   * m0 +X, m1 +Z, m2 +Y, wrapped joints at n1 and n2. */
  function chain(): Design {
    const d = createEmptyDesign('d', 'chain');
    d.nodes.push(
      { id: 'n0', position: V(0, 0, 0) },
      { id: 'n1', position: V(1, 0, 0) },
      { id: 'n2', position: V(1, 0, 1) },
      { id: 'n3', position: V(1, 1, 1) },
    );
    d.members.push(
      { id: 'm0', kind: 'straight', nodeA: 'n0', nodeB: 'n1', size: '3/4"' },
      { id: 'm1', kind: 'straight', nodeA: 'n1', nodeB: 'n2', size: '3/4"' },
      { id: 'm2', kind: 'straight', nodeA: 'n2', nodeB: 'n3', size: '3/4"' },
    );
    d.joints.push(
      { id: 'pa', nodeId: 'n1', receiver: 'm0', mover: 'm1', onBody: false, mode: 'wrapped' },
      { id: 'pb', nodeId: 'n2', receiver: 'm1', mover: 'm2', onBody: false, mode: 'wrapped' },
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

describe('solve — closed loop of wrapped pivots (spatial)', () => {
  /** A square in the XZ plane with a wrapped pivot at each corner. Because each
   * hinge axis is its receiver's own (in-plane) direction, the axes are NOT
   * parallel → a spatial RRRR loop, which Grübler counts as over-constrained. */
  function square(): Design {
    const d = createEmptyDesign('d', 'square');
    d.nodes.push(
      { id: 'n0', position: V(0, 0, 0) },
      { id: 'n1', position: V(1, 0, 0) },
      { id: 'n2', position: V(1, 0, 1) },
      { id: 'n3', position: V(0, 0, 1) },
    );
    d.members.push(
      { id: 'm0', kind: 'straight', nodeA: 'n0', nodeB: 'n1', size: '3/4"' },
      { id: 'm1', kind: 'straight', nodeA: 'n1', nodeB: 'n2', size: '3/4"' },
      { id: 'm2', kind: 'straight', nodeA: 'n2', nodeB: 'n3', size: '3/4"' },
      { id: 'm3', kind: 'straight', nodeA: 'n3', nodeB: 'n0', size: '3/4"' },
    );
    d.joints.push(
      { id: 'pv1', nodeId: 'n1', receiver: 'm0', mover: 'm1', onBody: false, mode: 'wrapped' },
      { id: 'pv2', nodeId: 'n2', receiver: 'm1', mover: 'm2', onBody: false, mode: 'wrapped' },
      { id: 'pv3', nodeId: 'n3', receiver: 'm2', mover: 'm3', onBody: false, mode: 'wrapped' },
      { id: 'pv0', nodeId: 'n0', receiver: 'm3', mover: 'm0', onBody: false, mode: 'wrapped' },
    );
    return d;
  }

  it('reports spatial mobility −2 (over-constrained)', () => {
    const r = solve(square(), { lengthsLocked: true, pivotAngles: {} }, 'pose');
    expect(r.diagnostics.mobilityDof).toBe(-2);
    expect(r.diagnostics.overConstrained).toBe(true);
  });

  it('loop closure keeps every member length exact', () => {
    // even forced by a slider, closure (dominant) preserves member lengths
    const r = solve(square(), { lengthsLocked: true, pivotAngles: { pv1: 0.4 } }, 'pose');
    const L = (a: string, b: string) => dist(at(r, a), at(r, b));
    expect(L('n0', 'n1')).toBeCloseTo(1, 2);
    expect(L('n1', 'n2')).toBeCloseTo(1, 2);
    expect(L('n2', 'n3')).toBeCloseTo(1, 2);
    expect(L('n3', 'n0')).toBeCloseTo(1, 2);
  });
});

describe('solve — closed loop containing free (ball) joints (locked)', () => {
  /** A quadrilateral loop with a FREE ball joint at every corner. Because there
   * is a loop, solvePose takes the loop-closure path — which previously FROZE
   * every free joint (so a free pivot behaved like a locked axis, the reported
   * bug from bug.pvc.json). Now the spanning-tree free joints are true 3-DOF
   * variables in the solve, so the loop can flex out of plane to follow a drag
   * while every member length stays exact. */
  function freeLoop(): Design {
    const d = createEmptyDesign('d', 'free loop');
    d.nodes.push(
      { id: 'n0', position: V(0, 0, 0) },
      { id: 'n1', position: V(1, 0, 0) },
      { id: 'n2', position: V(1, 0, 1) },
      { id: 'n3', position: V(0, 0, 1) },
    );
    d.members.push(
      { id: 'm0', kind: 'straight', nodeA: 'n0', nodeB: 'n1', size: '3/4"' },
      { id: 'm1', kind: 'straight', nodeA: 'n1', nodeB: 'n2', size: '3/4"' },
      { id: 'm2', kind: 'straight', nodeA: 'n2', nodeB: 'n3', size: '3/4"' },
      { id: 'm3', kind: 'straight', nodeA: 'n3', nodeB: 'n0', size: '3/4"' },
    );
    d.joints.push(
      { id: 'f1', nodeId: 'n1', receiver: 'm0', mover: 'm1', onBody: false, mode: 'free' },
      { id: 'f2', nodeId: 'n2', receiver: 'm1', mover: 'm2', onBody: false, mode: 'free' },
      { id: 'f3', nodeId: 'n3', receiver: 'm2', mover: 'm3', onBody: false, mode: 'free' },
      { id: 'f0', nodeId: 'n0', receiver: 'm3', mover: 'm0', onBody: false, mode: 'free' },
    );
    return d;
  }

  it('free joints articulate inside the loop; drag flexes it, lengths preserved', () => {
    const d = freeLoop();
    const r = solve(
      d,
      {
        lengthsLocked: true,
        pivotAngles: {},
        dragTarget: { nodeId: 'n2', position: V(1, 0.7, 1) },
      },
      'pose',
    );
    const L = (a: string, b: string) => dist(at(r, a), at(r, b));
    // every member length stays exact around the loop (closure dominates)
    expect(L('n0', 'n1')).toBeCloseTo(1, 2);
    expect(L('n1', 'n2')).toBeCloseTo(1, 2);
    expect(L('n2', 'n3')).toBeCloseTo(1, 2);
    expect(L('n3', 'n0')).toBeCloseTo(1, 2);
    // the loop left its drawn plane to follow the drag — impossible when the free
    // joints are frozen (the pre-fix behavior kept n2.y ≈ 0)
    expect(at(r, 'n2').y).toBeGreaterThan(0.2);
    // and at least one free joint actually rotated (non-identity orientation)
    const moved = Object.values(r.jointOrientations).some((q) => Math.hypot(q.x, q.y, q.z) > 1e-3);
    expect(moved).toBe(true);
  });

  it('reports a mobile (not over-constrained) spherical loop', () => {
    const r = solve(freeLoop(), { lengthsLocked: true, pivotAngles: {} }, 'pose');
    // 4 bodies, 4 ball joints: 6·3 − (6·4 − 12) = 6 DOF
    expect(r.diagnostics.mobilityDof).toBe(6);
    expect(r.diagnostics.overConstrained).toBe(false);
  });
});

describe('solve — determinism & rigidity', () => {
  it('is reproducible for identical inputs', () => {
    const d = wrappedL();
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
