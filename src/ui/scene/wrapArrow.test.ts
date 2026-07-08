import { describe, expect, it } from 'vitest';
import { dot, length, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';
import { buildWrapArrow, type WrapArrowInput } from './wrapArrow';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// A 3/4" branch meeting a run along +X at the origin, branch going up +Y.
const base: WrapArrowInput = {
  node: V(0, 0, 0),
  axis: V(1, 0, 0),
  receiverR: 0.0134, // ~3/4" OD / 2
  moverTip: V(0, 0.0388, 0), // node + branchOut*(receiverR + 1")
  branchOut: V(0, 1, 0),
  branchODM: 0.0267,
};

/** Perpendicular distance of a point from the run axis line through `node`. */
function radialDist(p: Vec3, node: Vec3, axis: Vec3): number {
  const d = sub(p, node);
  const along = dot(d, axis);
  return length(sub(d, { x: axis.x * along, y: axis.y * along, z: axis.z * along }));
}

describe('buildWrapArrow', () => {
  it('starts at the branch open end and returns near it', () => {
    const a = buildWrapArrow(base)!;
    expect(a.path[0]).toEqual(base.moverTip);
    // the arrowhead returns close to (but not exactly at) the start
    const gap = length(sub(a.tip, base.moverTip));
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(0.02);
  });

  it('loops once hugging the run just outside its surface', () => {
    const a = buildWrapArrow(base)!;
    // the loop samples (skip the two lead-in/out + endpoints) ring the run at
    // a radius just past the run OD/2, never inside it
    const loop = a.path.slice(2, a.path.length - 2);
    for (const p of loop) {
      const r = radialDist(p, base.node, base.axis);
      expect(r).toBeGreaterThan(base.receiverR); // outside the pipe wall
      expect(r).toBeLessThan(base.receiverR + base.branchODM); // still hugging it
    }
    // a full turn: some sample swings to the opposite side of the run from the
    // branch (its component along −branchOut is clearly negative)
    const minAlongBranch = Math.min(...loop.map((p) => dot(sub(p, base.node), base.branchOut)));
    expect(minAlongBranch).toBeLessThan(-base.receiverR * 0.5);
  });

  it('reports a unit arrowhead direction and a pin on the far side of the run', () => {
    const a = buildWrapArrow(base)!;
    expect(length(a.tipDir)).toBeCloseTo(1, 6);
    // the pin sits OPPOSITE the branch (so the branch pipe end can't occlude it)
    expect(dot(a.pinDir, base.branchOut)).toBeLessThan(-0.99);
    expect(radialDist(a.pinBase, base.node, base.axis)).toBeGreaterThan(base.receiverR);
  });

  it('handles a branch nearly parallel to the run (degenerate radial)', () => {
    const a = buildWrapArrow({ ...base, branchOut: V(1, 0, 0), moverTip: V(0.04, 0, 0) })!;
    expect(a).not.toBeNull();
    expect(a.path.length).toBeGreaterThan(4);
    for (const p of a.path.slice(2, a.path.length - 2)) {
      expect(Number.isFinite(radialDist(p, base.node, base.axis))).toBe(true);
    }
  });

  it('returns null for a degenerate run axis', () => {
    expect(buildWrapArrow({ ...base, axis: V(0, 0, 0) })).toBeNull();
  });
});
