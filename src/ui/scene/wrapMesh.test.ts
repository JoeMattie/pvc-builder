import { describe, expect, it } from 'vitest';
import { length, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';
import { buildWrapMesh, type WrapCyl, type WrapInput } from './wrapMesh';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// a through pipe along +X (OD 1"), a branch coming down from +Z onto its middle
const base: WrapInput = {
  through: { a: V(-0.5, 0, 0), b: V(0.5, 0, 0), odM: 0.0254 },
  wrapPoint: V(0, 0, 0),
  branchDir: V(0, 0, 1),
  branchODM: 0.0254,
  rigid: true,
};

const cyls = (m: { prims: Array<{ kind: string }> }): WrapCyl[] =>
  m.prims.filter((p): p is WrapCyl => p.kind === 'cylinder');

describe('buildWrapMesh (slip saddle fitting)', () => {
  it('composes a collar + branch socket boss + a blend body', () => {
    const m = buildWrapMesh(base)!;
    expect(cyls(m).length).toBeGreaterThanOrEqual(3); // collar + boss + bell lips
    expect(m.prims.some((p) => p.kind === 'sphere')).toBe(true); // blend body
  });

  it('the collar is coaxial with the run and slips OVER it', () => {
    const m = buildWrapMesh(base)!;
    const rt = base.through.odM / 2;
    // the longest cylinder is the collar sleeve
    const collar = cyls(m).sort((a, b) => length(sub(b.b, b.a)) - length(sub(a.b, a.a)))[0]!;
    const dir = sub(collar.b, collar.a);
    expect(Math.abs(dir.x)).toBeGreaterThan(0); // along the run (+X)
    expect(Math.abs(dir.z)).toBeCloseTo(0, 6);
    expect(collar.radiusM).toBeGreaterThan(rt); // encircles the run pipe
  });

  it('rigid gets set screws; pivot drops them', () => {
    expect(buildWrapMesh({ ...base, rigid: true })!.screws.length).toBe(2);
    expect(buildWrapMesh({ ...base, rigid: false })!.screws.length).toBe(0);
  });

  it('bails on a degenerate through pipe', () => {
    expect(
      buildWrapMesh({ ...base, through: { a: V(0, 0, 0), b: V(0, 0, 0), odM: 0.0254 } }),
    ).toBeNull();
  });
});
