import { describe, expect, it } from 'vitest';
import { appendPipe, startPath } from '../../design/docOps';
import { createEmptyDesign, type Design, pipeSpec, type Vec3 } from '../../schema';
import { buildPipeModel } from './pipeModel';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function lPath(size: '1/2"' | '3/4"' = '3/4"'): Design {
  let d = createEmptyDesign('d', 'L');
  const s = startPath(d, V(0, 0, 0));
  d = s.design;
  const p1 = appendPipe(d, s.nodeId, V(1, 0, 0), size);
  d = p1.design;
  const p2 = appendPipe(d, p1.nodeId, V(1, 0, 1), size);
  return p2.design;
}

describe('buildPipeModel', () => {
  it('emits one cylinder per member at true OD radius', () => {
    const model = buildPipeModel(lPath('3/4"'));
    expect(model.cylinders).toHaveLength(2);
    const expectedR = pipeSpec('3/4"').odM / 2;
    for (const c of model.cylinders) expect(c.radiusM).toBeCloseTo(expectedR, 12);
  });

  it('uses the correct OD per size (1/2" vs 3/4")', () => {
    expect(buildPipeModel(lPath('1/2"')).cylinders[0]!.radiusM).toBeCloseTo(
      pipeSpec('1/2"').odM / 2,
      12,
    );
  });

  it('rounds every pipe-carrying node and sizes the joint to its thickest member', () => {
    const model = buildPipeModel(lPath('3/4"'));
    expect(model.joints).toHaveLength(3);
    for (const j of model.joints) expect(j.radiusM).toBeCloseTo(pipeSpec('3/4"').odM / 2, 12);
  });

  it('skips nodes with no incident members', () => {
    const empty = createEmptyDesign('d', 'empty');
    expect(buildPipeModel(empty)).toEqual({ cylinders: [], joints: [] });
  });
});
