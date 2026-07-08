import { describe, expect, it } from 'vitest';
import { dot, length, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';
import { buildWrapMesh, type WrapInput } from './wrapMesh';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// a through pipe along +X (OD 1"), a branch coming down from +Z onto its middle
const base: WrapInput = {
  through: { a: V(-0.5, 0, 0), b: V(0.5, 0, 0), odM: 0.0254 },
  wrapPoint: V(0, 0, 0),
  branchDir: V(0, 0, 1), // outward along the branch
  branchODM: 0.0254,
  rigid: true,
};

describe('buildWrapMesh', () => {
  it('returns a faceted strip that hugs the through pipe', () => {
    const m = buildWrapMesh(base)!;
    expect(m.facets.length).toBeGreaterThan(6);
    const rt = base.through.odM / 2;
    for (const f of m.facets) {
      // every facet centre sits just outside the through pipe surface
      const r = length(sub(f.center, base.wrapPoint));
      expect(r).toBeGreaterThan(rt);
      expect(r).toBeLessThan(rt + base.branchODM); // hugs, not floating away
      // width runs along the through axis; thickness is radial (⟂ the axis)
      expect(Math.abs(f.widthDir.x)).toBeCloseTo(1, 6);
      expect(Math.abs(dot(f.thickDir, V(1, 0, 0)))).toBeLessThan(1e-6);
    }
  });

  it('rigid wraps get screw discs and no pivot axis', () => {
    const m = buildWrapMesh({ ...base, rigid: true })!;
    expect(m.screws.length).toBe(2);
    expect(m.axis).toBeNull();
    // screws face radially outward, sitting on the strip surface
    for (const s of m.screws) expect(length(sub(s.center, base.wrapPoint))).toBeGreaterThan(0);
  });

  it('pivot wraps drop the screws and expose the hinge axis along the run', () => {
    const m = buildWrapMesh({ ...base, rigid: false })!;
    expect(m.screws.length).toBe(0);
    expect(m.axis).not.toBeNull();
    // the hinge axis is the through-pipe direction (+X)
    const dir = sub(m.axis!.b, m.axis!.a);
    expect(Math.abs(dir.x)).toBeGreaterThan(0);
    expect(Math.abs(dir.z)).toBeCloseTo(0, 6);
  });

  it('bails on a degenerate through pipe', () => {
    expect(
      buildWrapMesh({ ...base, through: { a: V(0, 0, 0), b: V(0, 0, 0), odM: 0.0254 } }),
    ).toBeNull();
  });
});
