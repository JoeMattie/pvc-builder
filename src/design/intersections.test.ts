import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type NominalSize, type Vec3 } from '../schema';
import { intersectingMembers, segmentSegmentDistSq } from './intersections';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Build a design from explicit straight members given as endpoint pairs. */
function straightDesign(
  members: Array<{ id: string; a: Vec3; b: Vec3; size?: NominalSize }>,
): Design {
  const d = createEmptyDesign('d', 'x');
  let n = 0;
  for (const m of members) {
    const na = `n${n++}`;
    const nb = `n${n++}`;
    d.nodes.push({ id: na, position: m.a }, { id: nb, position: m.b });
    d.members.push({ id: m.id, kind: 'straight', nodeA: na, nodeB: nb, size: m.size ?? '3/4"' });
  }
  return d;
}

describe('segmentSegmentDistSq', () => {
  it('is 0 for crossing segments', () => {
    expect(segmentSegmentDistSq(V(-1, 0, 0), V(1, 0, 0), V(0, 0, -1), V(0, 0, 1))).toBeCloseTo(
      0,
      9,
    );
  });
  it('measures the gap between parallel segments', () => {
    expect(
      Math.sqrt(segmentSegmentDistSq(V(0, 0, 0), V(1, 0, 0), V(0, 0, 0.5), V(1, 0, 0.5))),
    ).toBeCloseTo(0.5, 9);
  });
});

describe('intersectingMembers', () => {
  it('flags two crossing pipes that do not share a node', () => {
    const d = straightDesign([
      { id: 'h', a: V(-0.5, 0, 0), b: V(0.5, 0, 0) },
      { id: 'v', a: V(0, 0, -0.5), b: V(0, 0, 0.5) },
    ]);
    expect(intersectingMembers(d)).toEqual(new Set(['h', 'v']));
  });

  it('does not flag pipes that only meet at a shared node (a joint)', () => {
    const d = createEmptyDesign('d', 'L');
    d.nodes.push(
      { id: 'a', position: V(0, 0, 0) },
      { id: 'c', position: V(0.5, 0, 0) },
      { id: 'b', position: V(0.5, 0, 0.5) },
    );
    d.members.push(
      { id: 'm1', kind: 'straight', nodeA: 'a', nodeB: 'c', size: '3/4"' },
      { id: 'm2', kind: 'straight', nodeA: 'c', nodeB: 'b', size: '3/4"' },
    );
    expect(intersectingMembers(d).size).toBe(0);
  });

  it('does not flag pipes that pass far apart', () => {
    const d = straightDesign([
      { id: 'a', a: V(0, 0, 0), b: V(1, 0, 0) },
      { id: 'b', a: V(0, 0, 0.5), b: V(1, 0, 0.5) },
    ]);
    expect(intersectingMembers(d).size).toBe(0);
  });

  it('flags a formed pipe overlapping a straight pipe', () => {
    const d = createEmptyDesign('d', 'formed-cross');
    d.nodes.push(
      { id: 'fa', position: V(-0.5, 0, 0.2) },
      { id: 'fb', position: V(0.5, 0, 0.2) },
      { id: 'sa', position: V(0, 0, -0.4) },
      { id: 'sb', position: V(0, 0, 0.4) },
    );
    // formed pipe dips through the origin plane, crossing the straight pipe
    d.members.push(
      {
        id: 'formed',
        kind: 'formed',
        nodeA: 'fa',
        nodeB: 'fb',
        controlPoints: [V(0, 0, 0.2)],
        size: '3/4"',
      },
      { id: 'straight', kind: 'straight', nodeA: 'sa', nodeB: 'sb', size: '3/4"' },
    );
    expect(intersectingMembers(d)).toEqual(new Set(['formed', 'straight']));
  });

  it('does not flag a heat-wrapped branch against its through pipe', () => {
    // a run + a branch whose end touches the run body (a T) but shares no node
    const d = straightDesign([
      { id: 'run', a: V(-0.25, 0, 0), b: V(0.25, 0, 0) },
      { id: 'branch', a: V(0, 0, 0.2), b: V(0, 0, 0) },
    ]);
    // without a joint the touching pair IS flagged
    expect(intersectingMembers(d)).toEqual(new Set(['run', 'branch']));
    // the branch's end node is n3 (straightDesign numbers nodes in order)
    d.joints.push({
      id: 'jt1',
      nodeId: 'n3',
      receiver: 'run',
      mover: 'branch',
      onBody: true,
      mode: 'anchor',
    });
    expect(intersectingMembers(d).size).toBe(0);
  });
});
