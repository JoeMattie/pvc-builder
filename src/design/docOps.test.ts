import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import {
  appendPipe,
  deleteMember,
  memberLengthM,
  nodeById,
  nodeDegrees,
  setMemberLengthM,
  setNodePosition,
  startPath,
} from './docOps';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Draw a path through the given points, returning the final design and the
 * member ids in draw order (mirrors what the draw tool does per click). */
function drawPath(points: Vec3[], size: '1/2"' | '3/4"' = '3/4"') {
  let d: Design = createEmptyDesign('d', 'Path');
  const started = startPath(d, points[0]!);
  d = started.design;
  let from = started.nodeId;
  const memberIds: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const step = appendPipe(d, from, points[i]!, size);
    d = step.design;
    from = step.nodeId;
    memberIds.push(step.memberId);
  }
  return { design: d, memberIds };
}

describe('drawing a pipe path', () => {
  it('creates one node per point and one member per segment', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(0.3, 0, 0), V(0.3, 0, 0.4)]);
    expect(design.nodes).toHaveLength(3);
    expect(design.members).toHaveLength(2);
    expect(memberIds).toHaveLength(2);
  });

  it('preserves segment lengths within 1e-6 m (Phase 1 acceptance)', () => {
    const pts = [V(0, 0, 0), V(0.3, 0, 0), V(0.3, 0, 0.4), V(0.9, 0, 0.4)];
    const expected = [0.3, 0.4, 0.6];
    const { design, memberIds } = drawPath(pts);
    for (let i = 0; i < memberIds.length; i++) {
      const m = design.members.find((mm) => mm.id === memberIds[i])!;
      expect(memberLengthM(design, m)).toBeCloseTo(expected[i]!, 6);
    }
  });

  it('carries the drawn size onto each member', () => {
    const { design } = drawPath([V(0, 0, 0), V(1, 0, 0)], '1/2"');
    expect(design.members[0]!.size).toBe('1/2"');
  });
});

describe('setMemberLengthM', () => {
  it('sets an exact length along the current axis, keeping nodeA fixed', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(0.3, 0, 0.4)]); // len 0.5
    const m = design.members[0]!;
    const out = setMemberLengthM(design, memberIds[0]!, 1);
    const om = out.members[0]!;
    expect(memberLengthM(out, om)).toBeCloseTo(1, 6);
    // nodeA unchanged, direction preserved (was 0.6/0.8 unit on x/z)
    expect(nodeById(out, m.nodeA)!.position).toEqual(V(0, 0, 0));
    const b = nodeById(out, m.nodeB)!.position;
    expect(b.x).toBeCloseTo(0.6, 6);
    expect(b.z).toBeCloseTo(0.8, 6);
  });

  it('extends a degenerate member along +X', () => {
    const { design, memberIds } = drawPath([V(1, 0, 0), V(1, 0, 0)]); // zero length
    const out = setMemberLengthM(design, memberIds[0]!, 0.5);
    const b = nodeById(out, out.members[0]!.nodeB)!.position;
    expect(b).toEqual(V(1.5, 0, 0));
  });
});

describe('setNodePosition (drag)', () => {
  it('moves a shared node so both incident members follow', () => {
    const { design } = drawPath([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]);
    const mid = design.nodes[1]!.id;
    const out = setNodePosition(design, mid, V(1, 0, 1));
    expect(memberLengthM(out, out.members[0]!)).toBeCloseTo(Math.hypot(1, 1), 9);
    expect(memberLengthM(out, out.members[1]!)).toBeCloseTo(Math.hypot(1, 1), 9);
  });
});

describe('deleteMember', () => {
  it('removes the member and prunes orphaned nodes only', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]);
    // deleting the last segment orphans the end node but not the shared middle
    const out = deleteMember(design, memberIds[1]!);
    expect(out.members).toHaveLength(1);
    expect(out.nodes).toHaveLength(2);
  });
});

describe('nodeDegrees', () => {
  it('counts incident members per node', () => {
    const { design } = drawPath([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]);
    const deg = nodeDegrees(design);
    const [a, b, c] = design.nodes;
    expect(deg.get(a!.id)).toBe(1);
    expect(deg.get(b!.id)).toBe(2);
    expect(deg.get(c!.id)).toBe(1);
  });
});
