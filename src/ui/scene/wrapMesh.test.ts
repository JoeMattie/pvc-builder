import { describe, expect, it } from 'vitest';
import { length } from '../../geometry/math3';
import type { Vec3 } from '../../schema';
import { buildWrapMesh, type WrapInput } from './wrapMesh';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// a through pipe along +X (OD 1"), a branch coming down from +Z onto its middle
const base: WrapInput = {
  through: { a: V(-0.5, 0, 0), b: V(0.5, 0, 0), odM: 0.0254 },
  wrapPoint: V(0, 0, 0),
  branchDir: V(0, 0, 1),
  branchODM: 0.0254,
  rigid: true,
};

describe('buildWrapMesh', () => {
  it('sweeps a closed strip mesh that hugs the through pipe', () => {
    const m = buildWrapMesh(base)!;
    expect(m.positions.length % 3).toBe(0);
    const verts = m.positions.length / 3;
    expect(verts).toBeGreaterThan(100); // a smooth helix, not a few facets
    expect(m.indices.length % 3).toBe(0);
    // every vertex sits within [rt, rt + branchOD] of the wrap point radially in
    // the plane ⟂ the run (so the strip hugs the pipe, not floating off)
    const rt = base.through.odM / 2;
    for (let i = 0; i < m.positions.length; i += 3) {
      const p = V(m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!);
      const radial = length(V(0, p.y, p.z)); // ⟂ the +X run
      expect(radial).toBeGreaterThan(rt - 1e-6);
      expect(radial).toBeLessThan(rt + base.branchODM);
    }
  });

  it('wraps a full turn (vertices appear on both sides of the pipe)', () => {
    const m = buildWrapMesh(base)!;
    let front = false;
    let back = false;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (m.positions[i + 2]! > 0.005) front = true; // +Z (branch side)
      if (m.positions[i + 2]! < -0.005) back = true; // −Z (far side)
    }
    expect(front && back).toBe(true);
  });

  it('rigid wraps get screw discs; pivot wraps drop them', () => {
    expect(buildWrapMesh({ ...base, rigid: true })!.screws.length).toBe(2);
    expect(buildWrapMesh({ ...base, rigid: false })!.screws.length).toBe(0);
  });

  it('bails on a degenerate through pipe', () => {
    expect(
      buildWrapMesh({ ...base, through: { a: V(0, 0, 0), b: V(0, 0, 0), odM: 0.0254 } }),
    ).toBeNull();
  });
});
