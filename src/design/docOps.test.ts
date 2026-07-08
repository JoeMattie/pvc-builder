import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import {
  addPivot,
  addWrap,
  appendPipe,
  deleteMember,
  memberLengthM,
  nodeById,
  nodeDegrees,
  removeWrap,
  resetPivots,
  setMemberLengthM,
  setNodePosition,
  setPivotAngle,
  setWrapRigid,
  splitMemberAt,
  startPath,
  translateMember,
  wrapsAtNode,
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

describe('pivots', () => {
  it('deleting a pipe removes pivots that referenced it (no orphans)', () => {
    // L path → corner node shared by two members; make it a pivot
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const withPivot = addPivot(design, corner).design;
    expect(withPivot.pivots).toHaveLength(1);
    // deleting one of the pivot's members must drop the pivot
    const out = deleteMember(withPivot, memberIds[0]!);
    expect(out.pivots).toHaveLength(0);
  });

  it('resetPivots zeroes every pivot angle', () => {
    const { design } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const added = addPivot(design, corner);
    const posed = setPivotAngle(added.design, added.pivotId!, 1.2);
    expect(posed.pivots[0]!.angleRad).toBe(1.2);
    expect(resetPivots(posed).pivots[0]!.angleRad).toBe(0);
  });
});

describe('translateMember', () => {
  it('moves both endpoints by delta, preserving length', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(0.3, 0, 0)]);
    const before = memberLengthM(design, design.members[0]!);
    const out = translateMember(design, memberIds[0]!, V(0.1, 0.5, -0.2));
    const m = out.members[0]!;
    const a = nodeById(out, m.nodeA)!;
    const b = nodeById(out, m.nodeB)!;
    expect(a.position).toEqual(V(0.1, 0.5, -0.2));
    expect(b.position).toEqual(V(0.4, 0.5, -0.2));
    expect(memberLengthM(out, m)).toBeCloseTo(before, 9);
  });
});

describe('splitMemberAt', () => {
  it('replaces a straight member with two collinear members sharing a new node', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const r = splitMemberAt(design, memberIds[0]!, V(0.4, 0, 0));
    expect(r.nodeId).not.toBeNull();
    expect(r.design.members).toHaveLength(2); // A–N and N–B
    expect(r.design.nodes).toHaveLength(3);
    // the two halves are collinear and meet at the split node
    const split = nodeById(r.design, r.nodeId!)!;
    expect(split.position).toEqual(V(0.4, 0, 0));
    // the new node has degree 2 (the run passes through it)
    expect(nodeDegrees(r.design).get(r.nodeId!)).toBe(2);
  });

  it('reuses an existing endpoint node instead of a zero-length stub', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const endpoint = design.members[0]!.nodeB;
    const r = splitMemberAt(design, memberIds[0]!, V(1, 0, 0));
    expect(r.nodeId).toBe(endpoint);
    expect(r.design.members).toHaveLength(1); // unchanged
  });
});

describe('heat-wrapped tees', () => {
  // a run pipe + a branch that ends partway along it (a wrap)
  function runWithBranch() {
    const run = drawPath([V(0, 0, 0), V(1, 0, 0)]); // through pipe
    const throughId = run.memberIds[0]!;
    // branch from (0.5, 0, 0.4) down to the run body at (0.5, 0, 0)
    const started = startPath(run.design, V(0.5, 0, 0.4));
    let d = started.design;
    const step = appendPipe(d, started.nodeId, V(0.5, 0, 0), '3/4"');
    d = step.design;
    return { design: d, throughId, branchNode: step.nodeId };
  }

  it('addWrap records a rigid tee onto the intact run (no split)', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const r = addWrap(design, throughId, branchNode);
    expect(r.wrapId).not.toBeNull();
    expect(r.design.wraps).toHaveLength(1);
    expect(r.design.wraps[0]!.rigid).toBe(true); // screwed by default
    expect(r.design.members).toHaveLength(2); // run NOT cut
    expect(wrapsAtNode(r.design, branchNode)).toHaveLength(1);
  });

  it('refuses a duplicate wrap at the same branch node', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const once = addWrap(design, throughId, branchNode).design;
    expect(addWrap(once, throughId, branchNode).wrapId).toBeNull();
  });

  it('toggles rigid ⇄ pivot', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const r = addWrap(design, throughId, branchNode);
    const asPivot = setWrapRigid(r.design, r.wrapId!, false);
    expect(asPivot.wraps[0]!.rigid).toBe(false);
    expect(removeWrap(asPivot, r.wrapId!).wraps).toHaveLength(0);
  });

  it('deleting the through pipe drops its wraps', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const withWrap = addWrap(design, throughId, branchNode).design;
    expect(deleteMember(withWrap, throughId).wraps).toHaveLength(0);
  });

  it('deleting the branch pipe drops the wrap (orphaned branch node)', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const withWrap = addWrap(design, throughId, branchNode).design;
    const branchMember = withWrap.members.find(
      (m) => m.nodeA === branchNode || m.nodeB === branchNode,
    )!;
    expect(deleteMember(withWrap, branchMember.id).wraps).toHaveLength(0);
  });
});
