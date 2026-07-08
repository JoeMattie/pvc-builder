import { describe, expect, it } from 'vitest';
import type { ResolvedFitting } from '../../design/fittings';
import { pipeSpec, type Vec3 } from '../../schema';
import { buildFittingMesh } from './fittingMesh';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function fitting(type: ResolvedFitting['type'], ends: ResolvedFitting['ends']): ResolvedFitting {
  return { nodeId: 'c', position: V(0, 0, 0), type, ends, reducing: false };
}
const end = (dir: Vec3, size: '1/2"' | '3/4"' = '3/4"') => ({ memberId: 'm', dir, size });

describe('buildFittingMesh', () => {
  it('a coupling is two hubs + two bells, no blend body', () => {
    const m = buildFittingMesh(fitting('coupling', [end(V(1, 0, 0)), end(V(-1, 0, 0))]));
    expect(m.prims.filter((p) => p.kind === 'cylinder')).toHaveLength(4);
    expect(m.prims.some((p) => p.kind === 'sphere')).toBe(false);
  });

  it('an elbow adds a blend sphere at the joint', () => {
    const m = buildFittingMesh(fitting('elbow90', [end(V(1, 0, 0)), end(V(0, 0, 1))]));
    expect(m.prims.some((p) => p.kind === 'sphere')).toBe(true);
  });

  it('a tee has three hubs (+ bells + body)', () => {
    const m = buildFittingMesh(
      fitting('tee', [end(V(1, 0, 0)), end(V(-1, 0, 0)), end(V(0, 0, 1))]),
    );
    expect(m.prims.filter((p) => p.kind === 'cylinder')).toHaveLength(6);
    expect(m.prims.filter((p) => p.kind === 'sphere')).toHaveLength(1);
  });

  it('a cross has four hubs (+ bells + body)', () => {
    const m = buildFittingMesh(
      fitting('cross', [end(V(1, 0, 0)), end(V(-1, 0, 0)), end(V(0, 0, 1)), end(V(0, 0, -1))]),
    );
    expect(m.prims.filter((p) => p.kind === 'cylinder')).toHaveLength(8);
  });

  it('sizes the hub sleeve larger than the pipe OD', () => {
    const m = buildFittingMesh(
      fitting('coupling', [end(V(1, 0, 0), '3/4"'), end(V(-1, 0, 0), '3/4"')]),
    );
    const hub = m.prims.find((p) => p.kind === 'cylinder') as { radiusM: number };
    expect(hub.radiusM).toBeGreaterThan(pipeSpec('3/4"').odM / 2);
  });

  it('a reducer keeps each end at its own pipe size', () => {
    const m = buildFittingMesh(
      fitting('reducer', [end(V(1, 0, 0), '3/4"'), end(V(-1, 0, 0), '1/2"')]),
    );
    const radii = m.prims
      .filter(
        (p): p is { kind: 'cylinder'; a: Vec3; b: Vec3; radiusM: number } => p.kind === 'cylinder',
      )
      .map((p) => p.radiusM);
    // two distinct hub radii (one per size)
    expect(new Set(radii.map((r) => r.toFixed(6))).size).toBeGreaterThan(1);
  });
});
