import { describe, expect, it } from 'vitest';
import { developedLengthM } from '../geometry/pipe';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import {
  addBodyJoint,
  addMeasurement,
  appendPipe,
  bendMember,
  dedupeJoints,
  deleteMember,
  detachMemberEnd,
  healBodyJoints,
  joinContext,
  jointsAtNode,
  makeFreeHub,
  makeManufacturedJoint,
  measurementLengthM,
  measurePerp,
  memberLengthM,
  moveControlPoint,
  nodeById,
  nodeDegrees,
  reconcileBodyJoints,
  removeJoint,
  removeMeasurement,
  resetJoints,
  rotateMember,
  setJoinMode,
  setJointAngle,
  setMeasurementOffset,
  setMemberLengthM,
  setMemberSize,
  setNodePosition,
  splitMemberAt,
  startPath,
  swapReceiver,
  translateMember,
  weldNodes,
} from './docOps';
import { resolveFittings } from './fittings';

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

/** A run along X plus a separate branch whose START end lands on the run's span
 * at `branchOnRun` (a tee that never formed a union). */
function branchOnRun(onRun: Vec3, branchFar: Vec3): Design {
  const d = createEmptyDesign('d', 'Heal');
  d.nodes.push(
    { id: 'r0', position: V(-0.3, 0, 0) },
    { id: 'r1', position: V(0.3, 0, 0) },
    { id: 'bn', position: onRun },
    { id: 'bf', position: branchFar },
  );
  d.members.push(
    { id: 'run', kind: 'straight', nodeA: 'r0', nodeB: 'r1', size: '3/4"' },
    { id: 'branch', kind: 'straight', nodeA: 'bn', nodeB: 'bf', size: '3/4"' },
  );
  return d;
}

describe('healBodyJoints', () => {
  it('creates a rigid on-body union for a branch end sitting on a run span', () => {
    const healed = healBodyJoints(branchOnRun(V(0, 0, 0), V(0, 0, 0.3)));
    expect(healed.joints).toHaveLength(1);
    expect(healed.joints[0]).toMatchObject({
      mode: 'anchor',
      onBody: true,
      receiver: 'run',
      mover: 'branch',
      nodeId: 'bn',
    });
  });

  it('unions a FORMED (curve) branch end sitting on a straight run', () => {
    // a straight run + a formed pipe whose end lands on the run's span
    const d = createEmptyDesign('d', 'CurveHeal');
    d.nodes.push(
      { id: 'r0', position: V(-0.3, 0, 0) },
      { id: 'r1', position: V(0.3, 0, 0) },
      { id: 'cf', position: V(0, 0, 0.3) },
      { id: 'cn', position: V(0, 0, 0) }, // curve end on the run span
    );
    d.members.push(
      { id: 'run', kind: 'straight', nodeA: 'r0', nodeB: 'r1', size: '3/4"' },
      {
        id: 'curve',
        kind: 'formed',
        nodeA: 'cf',
        nodeB: 'cn',
        controlPoints: [V(0.1, 0, 0.15)],
        size: '3/4"',
      },
    );
    const healed = healBodyJoints(d);
    expect(healed.joints).toHaveLength(1);
    expect(healed.joints[0]).toMatchObject({ receiver: 'run', mover: 'curve', onBody: true });
  });

  it('is idempotent (no duplicate union) and leaves a real end alone', () => {
    const once = healBodyJoints(branchOnRun(V(0, 0, 0), V(0, 0, 0.3)));
    const twice = healBodyJoints(once);
    expect(twice.joints).toHaveLength(1);
    // a branch that does NOT touch the run gets no union
    expect(healBodyJoints(branchOnRun(V(0, 0.05, 0), V(0, 0.05, 0.3))).joints).toHaveLength(0);
  });
});

describe('reconcileBodyJoints (live connect / disconnect)', () => {
  it('creates a rigid union the moment a branch end lands on a run', () => {
    // branch off the run — no union yet
    const detached = branchOnRun(V(0, 0.05, 0), V(0, 0.05, 0.3));
    expect(reconcileBodyJoints(detached).joints).toHaveLength(0);
    // drop the branch end onto the run → union appears immediately
    const onRun = setNodePosition(detached, 'bn', V(0, 0, 0));
    const r = reconcileBodyJoints(onRun);
    expect(r.joints).toHaveLength(1);
    expect(r.joints[0]).toMatchObject({ mode: 'anchor', onBody: true, receiver: 'run' });
  });

  it('removes the union the moment the branch end leaves the run', () => {
    const attached = reconcileBodyJoints(branchOnRun(V(0, 0, 0), V(0, 0, 0.3)));
    expect(attached.joints).toHaveLength(1);
    // drag the branch end off the run
    const off = setNodePosition(attached, 'bn', V(0, 0.2, 0));
    expect(reconcileBodyJoints(off).joints).toHaveLength(0);
  });

  it('keeps a still-attached union and preserves its chosen mode', () => {
    let d = reconcileBodyJoints(branchOnRun(V(0, 0, 0), V(0, 0, 0.3)));
    d = { ...d, joints: d.joints.map((j) => ({ ...j, mode: 'wrapped' as const, angleRad: 0.5 })) };
    // slide the branch end ALONG the run — still attached
    d = reconcileBodyJoints(setNodePosition(d, 'bn', V(0.1, 0, 0)));
    expect(d.joints).toHaveLength(1);
    expect(d.joints[0]).toMatchObject({ mode: 'wrapped', angleRad: 0.5 });
  });

  it('leaves end-to-end (non-on-body) unions untouched', () => {
    const d = branchOnRun(V(0, 0, 0), V(0, 0, 0.3));
    const withEndToEnd: Design = {
      ...d,
      joints: [
        { id: 'e', nodeId: 'r1', receiver: 'run', mover: 'branch', onBody: false, mode: 'wrapped' },
      ],
    };
    expect(reconcileBodyJoints(withEndToEnd).joints.some((j) => j.id === 'e')).toBe(true);
  });
});

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

describe('joints — end-to-end pivots', () => {
  it('setJoinMode "wrapped" creates a wrapped pivot with the other pipe as receiver', () => {
    // L path → corner node shared by two members
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const out = setJoinMode(design, corner, memberIds[0]!, 'wrapped');
    expect(out.joints).toHaveLength(1);
    const j = out.joints[0]!;
    expect(j.mode).toBe('wrapped');
    expect(j.mover).toBe(memberIds[0]);
    expect(j.receiver).toBe(memberIds[1]);
    expect(j.onBody).toBe(false);
  });

  it('a "free" ball joint is offered end-to-end but not on a pipe body', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    expect(joinContext(design, corner, memberIds[0]!).canFree).toBe(true);
    const out = setJoinMode(design, corner, memberIds[0]!, 'free');
    expect(out.joints[0]!.mode).toBe('free');
  });

  it('"anchor" on an end-to-end join stores no record (the default rigid coupling)', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const withPivot = setJoinMode(design, corner, memberIds[0]!, 'wrapped');
    expect(withPivot.joints).toHaveLength(1);
    const reverted = setJoinMode(withPivot, corner, memberIds[0]!, 'anchor');
    expect(reverted.joints).toHaveLength(0);
  });

  it('swapReceiver flips which pipe wraps which', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const withPivot = setJoinMode(design, corner, memberIds[0]!, 'wrapped');
    const swapped = swapReceiver(withPivot, withPivot.joints[0]!.id);
    expect(swapped.joints[0]!.mover).toBe(memberIds[1]);
    expect(swapped.joints[0]!.receiver).toBe(memberIds[0]);
  });

  it('an existing joint can be re-changed: free → wrapped → anchor', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const free = setJoinMode(design, corner, memberIds[0]!, 'free');
    expect(free.joints[0]!.mode).toBe('free');
    // switching modes updates the SAME record (no duplicate), receiver preserved
    const wrapped = setJoinMode(free, corner, memberIds[0]!, 'wrapped');
    expect(wrapped.joints).toHaveLength(1);
    expect(wrapped.joints[0]!.mode).toBe('wrapped');
    expect(wrapped.joints[0]!.receiver).toBe(free.joints[0]!.receiver);
    // anchor on an end-to-end join drops the record (back to a rigid coupling)
    expect(setJoinMode(wrapped, corner, memberIds[0]!, 'anchor').joints).toHaveLength(0);
  });

  it('deleting a pipe removes joints that referenced it (no orphans)', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const withPivot = setJoinMode(design, corner, memberIds[0]!, 'wrapped');
    const out = deleteMember(withPivot, memberIds[0]!);
    expect(out.joints).toHaveLength(0);
  });

  it('resetJoints zeroes a wrapped angle and clears a free orientation', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = design.nodes[1]!.id;
    const added = setJoinMode(design, corner, memberIds[0]!, 'wrapped');
    const posed = setJointAngle(added, added.joints[0]!.id, 1.2);
    expect(posed.joints[0]!.angleRad).toBe(1.2);
    expect(resetJoints(posed).joints[0]!.angleRad).toBe(0);
  });
});

describe('makeFreeHub (shared ball joint, N pipes at one point)', () => {
  /** A star of pipes radiating from a shared centre node 'c'. The first pipe is
   * the longest, so it is the auto-picked common receiver. */
  function star(dirs: Vec3[]): Design {
    const d = createEmptyDesign('d', 'star');
    d.nodes.push({ id: 'c', position: V(0, 0, 0) });
    dirs.forEach((dir, i) => {
      const s = i === 0 ? 2 : 1; // pipe 0 is longest → the common receiver
      d.nodes.push({ id: `o${i}`, position: V(dir.x * s, dir.y * s, dir.z * s) });
      d.members.push({ id: `m${i}`, kind: 'straight', nodeA: 'c', nodeB: `o${i}`, size: '3/4"' });
    });
    return d;
  }
  const X = V(1, 0, 0);
  const NX = V(-1, 0, 0);
  const Y = V(0, 1, 0);
  const Z = V(0, 0, 1);
  const NZ = V(0, 0, -1);

  it('binds every incident pipe as a free joint sharing one receiver', () => {
    const out = makeFreeHub(star([X, NX, Z, NZ, Y]), 'c'); // 5 pipes
    const at = jointsAtNode(out, 'c');
    expect(at).toHaveLength(4); // one per pipe beyond the receiver
    expect(at.every((j) => j.mode === 'free' && !j.onBody)).toBe(true);
    expect(at.every((j) => j.receiver === 'm0')).toBe(true); // longest pipe
    expect(new Set(at.map((j) => j.mover))).toEqual(new Set(['m1', 'm2', 'm3', 'm4']));
  });

  it('exempts the hub node from fitting classification (no conflict for 5 pipes)', () => {
    const design = star([X, NX, Z, NZ, Y]);
    // without the hub, five pipes at one node is an unresolved conflict
    expect(resolveFittings(design).conflicts.some((c) => c.nodeId === 'c')).toBe(true);
    const hub = makeFreeHub(design, 'c');
    const res = resolveFittings(hub);
    expect(res.conflicts.some((c) => c.nodeId === 'c')).toBe(false);
    expect(res.fittings.some((f) => f.nodeId === 'c')).toBe(false); // the joint IS the fitting
  });

  it('is idempotent and preserves a mover free orientation', () => {
    const once = makeFreeHub(star([X, NX, Z, Y]), 'c');
    const j = once.joints.find((x) => x.mover === 'm2')!;
    const q = { x: 0, y: 0, z: 0.3826834, w: 0.9238795 };
    const posed = {
      ...once,
      joints: once.joints.map((x) => (x.id === j.id ? { ...x, orientation: q } : x)),
    };
    const twice = makeFreeHub(posed, 'c');
    expect(jointsAtNode(twice, 'c')).toHaveLength(3);
    expect(twice.joints.find((x) => x.mover === 'm2')?.orientation).toEqual(q);
  });

  it('is a no-op when fewer than two pipes end at the node', () => {
    const one = makeFreeHub(star([X]), 'c');
    expect(jointsAtNode(one, 'c')).toHaveLength(0);
  });
});

describe('rotateMember', () => {
  it('rotates both endpoints about a pivot, preserving length', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(0.4, 0, 0)]);
    const before = memberLengthM(design, design.members[0]!);
    const mid = V(0.2, 0, 0);
    // 90° about +Y around the midpoint → the pipe now runs along Z
    const out = rotateMember(design, memberIds[0]!, V(0, 1, 0), Math.PI / 2, mid);
    const m = out.members[0]!;
    const a = nodeById(out, m.nodeA)!.position;
    const b = nodeById(out, m.nodeB)!.position;
    expect(memberLengthM(out, m)).toBeCloseTo(before, 9);
    // endpoints swing to ±Z about the midpoint, x collapses to the pivot x
    expect(a.x).toBeCloseTo(0.2, 6);
    expect(b.x).toBeCloseTo(0.2, 6);
    expect(Math.abs(a.z - b.z)).toBeCloseTo(0.4, 6);
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

  it('addBodyJoint records a rigid on-body tee onto the intact run (no split)', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const r = addBodyJoint(design, throughId, branchNode);
    expect(r.jointId).not.toBeNull();
    expect(r.design.joints).toHaveLength(1);
    const j = r.design.joints[0]!;
    expect(j.mode).toBe('anchor'); // screwed by default
    expect(j.onBody).toBe(true);
    expect(j.receiver).toBe(throughId);
    expect(r.design.members).toHaveLength(2); // run NOT cut
    expect(jointsAtNode(r.design, branchNode)).toHaveLength(1);
  });

  it('refuses a duplicate joint at the same branch node', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const once = addBodyJoint(design, throughId, branchNode).design;
    expect(addBodyJoint(once, throughId, branchNode).jointId).toBeNull();
  });

  it('toggles an on-body joint anchor ⇄ wrapped pivot (record kept either way)', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const r = addBodyJoint(design, throughId, branchNode);
    const mover = r.design.joints[0]!.mover;
    const asPivot = setJoinMode(r.design, branchNode, mover, 'wrapped');
    expect(asPivot.joints[0]!.mode).toBe('wrapped');
    expect(asPivot.joints[0]!.onBody).toBe(true); // still on the run body
    expect(removeJoint(asPivot, r.jointId!).joints).toHaveLength(0);
  });

  it('an on-body branch can become a free ball joint (saddle eye bolt on the run)', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const withJoint = addBodyJoint(design, throughId, branchNode).design;
    const mover = withJoint.joints[0]!.mover;
    expect(joinContext(withJoint, branchNode, mover).canFree).toBe(true);
    const asFree = setJoinMode(withJoint, branchNode, mover, 'free');
    expect(asFree.joints[0]!.mode).toBe('free');
    expect(asFree.joints[0]!.onBody).toBe(true); // still on the run body
    expect(asFree.joints[0]!.receiver).toBe(throughId);
  });

  it('deleting the through pipe drops its joints', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const withJoint = addBodyJoint(design, throughId, branchNode).design;
    expect(deleteMember(withJoint, throughId).joints).toHaveLength(0);
  });

  it('deleting the branch pipe drops the joint (orphaned branch node)', () => {
    const { design, throughId, branchNode } = runWithBranch();
    const withJoint = addBodyJoint(design, throughId, branchNode).design;
    const branchMember = withJoint.members.find(
      (m) => m.nodeA === branchNode || m.nodeB === branchNode,
    )!;
    expect(deleteMember(withJoint, branchMember.id).joints).toHaveLength(0);
  });
});

describe('dedupeJoints (swapped / duplicate joint pairs)', () => {
  /** An L path whose corner node is shared by two members m0, m1. */
  function corner() {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    return { design, corner: design.nodes[1]!.id, m0: memberIds[0]!, m1: memberIds[1]! };
  }

  it('setJoinMode twice with swapped mover args yields exactly ONE joint', () => {
    const { design, corner: node, m0, m1 } = corner();
    // right-click pipe A near the shared node
    const afterA = setJoinMode(design, node, m0, 'wrapped');
    expect(afterA.joints).toHaveLength(1);
    // then right-click pipe B at the same node — must edit the SAME record
    const afterB = setJoinMode(afterA, node, m1, 'wrapped');
    expect(afterB.joints).toHaveLength(1);
    expect(afterB.joints[0]!.id).toBe(afterA.joints[0]!.id);
  });

  it('collapses a swapped wrapped+free pair to a single non-anchor joint', () => {
    const { design, corner: node, m0, m1 } = corner();
    const dupes: Design = {
      ...design,
      joints: [
        { id: 'j-wrap', nodeId: node, receiver: m0, mover: m1, onBody: false, mode: 'wrapped' },
        { id: 'j-free', nodeId: node, receiver: m1, mover: m0, onBody: false, mode: 'free' },
      ],
    };
    const out = dedupeJoints(dupes);
    expect(out.joints).toHaveLength(1);
    expect(out.joints[0]!.mode).not.toBe('anchor');
    // the LAST (most recently set) of the equally-preferred pair wins
    expect(out.joints[0]!.id).toBe('j-free');
  });

  it('prefers a non-anchor pivot over a default anchor when collapsing', () => {
    const { design, corner: node, m0, m1 } = corner();
    const dupes: Design = {
      ...design,
      joints: [
        { id: 'j-wrap', nodeId: node, receiver: m0, mover: m1, onBody: false, mode: 'wrapped' },
        { id: 'j-anchor', nodeId: node, receiver: m1, mover: m0, onBody: false, mode: 'anchor' },
      ],
    };
    const out = dedupeJoints(dupes);
    expect(out.joints).toHaveLength(1);
    expect(out.joints[0]!.id).toBe('j-wrap'); // the pivot, not the anchor
  });

  it('is a no-op (returns the same design) when there are no duplicates', () => {
    const clean = healBodyJoints(branchOnRun(V(0, 0, 0), V(0, 0, 0.3)));
    expect(clean.joints).toHaveLength(1);
    expect(dedupeJoints(clean)).toBe(clean);
  });

  it('leaves two DISTINCT joints (different member pairs) at one node intact', () => {
    // a cross: four members meet at one node
    const d = createEmptyDesign('d', 'Cross');
    d.nodes.push(
      { id: 'n', position: V(0, 0, 0) },
      { id: 'a', position: V(1, 0, 0) },
      { id: 'b', position: V(-1, 0, 0) },
      { id: 'c', position: V(0, 0, 1) },
    );
    d.members.push(
      { id: 'm1', kind: 'straight', nodeA: 'n', nodeB: 'a', size: '3/4"' },
      { id: 'm2', kind: 'straight', nodeA: 'n', nodeB: 'b', size: '3/4"' },
      { id: 'm3', kind: 'straight', nodeA: 'n', nodeB: 'c', size: '3/4"' },
    );
    const withTwo: Design = {
      ...d,
      joints: [
        { id: 'j1', nodeId: 'n', receiver: 'm1', mover: 'm2', onBody: false, mode: 'wrapped' },
        { id: 'j2', nodeId: 'n', receiver: 'm1', mover: 'm3', onBody: false, mode: 'free' },
      ],
    };
    const out = dedupeJoints(withTwo);
    expect(out.joints).toHaveLength(2);
    expect(out.joints.map((j) => j.id).sort()).toEqual(['j1', 'j2']);
  });

  it('reconcileBodyJoints heals the reported swapped shape to one joint', () => {
    // node with members m1, m2; a wrapped joint and its swapped free twin
    const { design, corner: node, m0: m1, m1: m2 } = corner();
    const reported: Design = {
      ...design,
      joints: [
        { id: 'j-wrap', nodeId: node, receiver: m1, mover: m2, onBody: false, mode: 'wrapped' },
        { id: 'j-free', nodeId: node, receiver: m2, mover: m1, onBody: false, mode: 'free' },
      ],
    };
    const healed = reconcileBodyJoints(reported);
    expect(healed.joints).toHaveLength(1);
  });
});

describe('makeManufacturedJoint', () => {
  it('snaps a near-90° corner to exactly 90° and drops the pivot record', () => {
    // two pipes meeting at ~85°; make the corner a wrapped pivot, then manufacture it
    const d0 = createEmptyDesign('d', 'Mfg');
    d0.nodes.push(
      { id: 'a', position: V(-1, 0, 0) },
      { id: 'c', position: V(0, 0, 0) }, // corner
      { id: 'e', position: V(0.087, 0, 0.996) }, // ~85° from +Z
    );
    d0.members.push(
      { id: 'mr', kind: 'straight', nodeA: 'a', nodeB: 'c', size: '3/4"' },
      { id: 'mm', kind: 'straight', nodeA: 'c', nodeB: 'e', size: '3/4"' },
    );
    const withPivot = setJoinMode(d0, 'c', 'mm', 'wrapped');
    expect(withPivot.joints).toHaveLength(1);
    const out = makeManufacturedJoint(withPivot, 'c', 'mm');
    // pivot record gone (→ resolveFittings will infer a socket elbow)
    expect(out.joints).toHaveLength(0);
    // the mover now leaves the corner at exactly 90° from the receiver
    const c = V(0, 0, 0);
    const dirR = nodeById(out, 'a')!.position; // receiver dir a-c is along -X from c → (a-c) = (-1,0,0)
    const e = nodeById(out, 'e')!.position;
    const recvDir = { x: dirR.x - c.x, y: 0, z: dirR.z - c.z };
    const moverDir = { x: e.x - c.x, y: e.y - c.y, z: e.z - c.z };
    const rl = Math.hypot(recvDir.x, recvDir.z);
    const ml = Math.hypot(moverDir.x, moverDir.y, moverDir.z);
    const cos = (recvDir.x * moverDir.x + recvDir.z * moverDir.z) / (rl * ml);
    expect(Math.acos(cos)).toBeCloseTo(Math.PI / 2, 4);
  });
});

describe('bendMember', () => {
  it('converts a straight pipe to a formed curve, endpoints fixed', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const m0 = design.members.find((m) => m.id === memberIds[0])!;
    const out = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 0.3), 0.06, {
      lockEndAngles: false,
    });
    const bent = out.members.find((m) => m.id === memberIds[0])!;
    expect(bent.kind).toBe('formed');
    // endpoints unchanged
    expect(bent.nodeA).toBe(m0.nodeA);
    expect(bent.nodeB).toBe(m0.nodeB);
    if (bent.kind === 'formed') {
      expect(bent.controlPoints).toHaveLength(1);
      // the single control point is pulled off-axis in +Z
      expect(bent.controlPoints[0]!.z).toBeGreaterThan(0.2);
    }
  });

  it('lockEndAngles adds straight lead-ins (3 control points)', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const out = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 0.3), 0.06, {
      lockEndAngles: true,
    });
    const bent = out.members.find((m) => m.id === memberIds[0])!;
    if (bent.kind === 'formed') {
      expect(bent.controlPoints).toHaveLength(3);
      // lead-ins stay on the axis (z ≈ 0), middle is pulled out
      expect(Math.abs(bent.controlPoints[0]!.z)).toBeLessThan(1e-9);
      expect(bent.controlPoints[1]!.z).toBeGreaterThan(0.2);
      expect(Math.abs(bent.controlPoints[2]!.z)).toBeLessThan(1e-9);
    }
  });

  it('moveControlPoint tweaks one control point of a bent pipe', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const bent = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 0.2), 0.06, {
      lockEndAngles: false,
    });
    const out = moveControlPoint(bent, memberIds[0]!, 0, V(0.5, 0, 0.5));
    const m = out.members.find((x) => x.id === memberIds[0])!;
    if (m.kind === 'formed') expect(m.controlPoints[0]).toEqual(V(0.5, 0, 0.5));
    // a straight member or bad index is a no-op
    expect(moveControlPoint(design, memberIds[0]!, 0, V(9, 9, 9))).toEqual(design);
  });

  it('re-bends an already-bent member (live drag) and clamps the pull', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const once = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 0.2), 0.06);
    // a second bend (huge pull) recomputes from the chord and clamps to the length
    const twice = bendMember(once, memberIds[0]!, 0.5, V(0, 0, 99), 0.06, { lockEndAngles: false });
    const bent = twice.members.find((m) => m.id === memberIds[0])!;
    if (bent.kind === 'formed') expect(bent.controlPoints[0]!.z).toBeLessThanOrEqual(1 + 1e-9);
  });

  // developed (filleted, cut) length of a formed member A → controls → B
  const pathLen = (d: Design, memberId: string) => {
    const m = d.members.find((x) => x.id === memberId)!;
    if (m.kind !== 'formed') return 0;
    const pts = [
      nodeById(d, m.nodeA)!.position,
      ...m.controlPoints,
      nodeById(d, m.nodeB)!.position,
    ];
    return developedLengthM(pts, m.filletRadiiM ?? []);
  };

  it('length-lock: conserves material length, drawing the far end IN', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]); // 1 m along X
    const out = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 0.3), 0.06, {
      lengthLock: { axisDir: V(1, 0, 0), lengthM: 1 },
    });
    const bent = out.members.find((m) => m.id === memberIds[0])!;
    expect(bent.kind).toBe('formed');
    // nodeA is the fixed anchor; nodeB slides in along +X, back onto the axis
    expect(nodeById(out, bent.nodeA)!.position).toEqual(V(0, 0, 0));
    const b = nodeById(out, bent.nodeB)!.position;
    expect(b.x).toBeLessThan(1); // chord shrank (didn't grow the pipe)
    expect(Math.abs(b.z)).toBeLessThan(1e-6);
    // the developed (cut) length is held at 1 m
    expect(pathLen(out, memberIds[0]!)).toBeCloseTo(1, 3);
  });

  it('length-lock + lockEndAngles: still 3 control points and conserves length', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const out = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 0.3), 0.06, {
      lockEndAngles: true,
      lengthLock: { axisDir: V(1, 0, 0), lengthM: 1 },
    });
    const bent = out.members.find((m) => m.id === memberIds[0])!;
    if (bent.kind === 'formed') expect(bent.controlPoints).toHaveLength(3);
    expect(pathLen(out, memberIds[0]!)).toBeCloseTo(1, 3);
  });

  it('length-lock with no perpendicular pull straightens back to length', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(0.6, 0, 0)]);
    // pull the far end out first (grow), then a length-lock with no pull resets it
    const grown = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 0.3), 0.06);
    const out = bendMember(grown, memberIds[0]!, 0.5, V(0, 0, 0), 0.06, {
      lengthLock: { axisDir: V(1, 0, 0), lengthM: 0.6 },
    });
    const m = out.members.find((x) => x.id === memberIds[0])!;
    expect(m.kind).toBe('straight');
    expect(nodeById(out, m.nodeB)!.position.x).toBeCloseTo(0.6, 6);
  });

  it('length-lock caps an oversized pull (no NaN, still conserves length)', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const out = bendMember(design, memberIds[0]!, 0.5, V(0, 0, 99), 0.06, {
      lengthLock: { axisDir: V(1, 0, 0), lengthM: 1 },
    });
    const bent = out.members.find((m) => m.id === memberIds[0])!;
    if (bent.kind === 'formed') expect(Number.isFinite(bent.controlPoints[0]!.z)).toBe(true);
    expect(pathLen(out, memberIds[0]!)).toBeCloseTo(1, 3);
  });
});

describe('setMemberSize', () => {
  it('changes only the target member size', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)], '3/4"');
    const out = setMemberSize(design, memberIds[0]!, '1/2"');
    expect(out.members.find((m) => m.id === memberIds[0])?.size).toBe('1/2"');
    expect(out.members.find((m) => m.id === memberIds[1])?.size).toBe('3/4"');
  });

  it('is a no-op for an unknown member id', () => {
    const { design } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    expect(setMemberSize(design, 'nope', '1/2"')).toEqual(design);
  });
});

describe('detachMemberEnd', () => {
  it('splits a shared node so one member moves independently', () => {
    // two members meeting at a shared middle node
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]);
    const shared = design.members.find((m) => m.id === memberIds[0])!.nodeB;
    const before = design.nodes.length;
    const r = detachMemberEnd(design, memberIds[0]!, shared);
    expect(r.nodeId).not.toBe(shared);
    expect(r.design.nodes).toHaveLength(before + 1);
    // member 0 now ends at the new node; member 1 still on the original
    const m0 = r.design.members.find((m) => m.id === memberIds[0])!;
    const m1 = r.design.members.find((m) => m.id === memberIds[1])!;
    expect(m0.nodeB).toBe(r.nodeId);
    expect(m1.nodeA).toBe(shared);
    // the new node is coincident with the old one (drag moves it afterward)
    expect(nodeById(r.design, r.nodeId)?.position).toEqual(nodeById(design, shared)?.position);
  });

  it('drops a joint tied to the detached member at that node', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]);
    const shared = design.members.find((m) => m.id === memberIds[0])!.nodeB;
    const withJoint: Design = {
      ...design,
      joints: [
        {
          id: 'jt',
          nodeId: shared,
          receiver: memberIds[1]!,
          mover: memberIds[0]!,
          onBody: false,
          mode: 'wrapped',
        },
      ],
    };
    const r = detachMemberEnd(withJoint, memberIds[0]!, shared);
    expect(r.design.joints).toHaveLength(0);
  });

  it('is a no-op at a lone (unshared) end', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const loneEnd = design.members.find((m) => m.id === memberIds[0])!.nodeB;
    const r = detachMemberEnd(design, memberIds[0]!, loneEnd);
    expect(r.nodeId).toBe(loneEnd);
    expect(r.design).toEqual(design);
  });
});

describe('weldNodes', () => {
  it('merges two coincident pipe ends into one junction', () => {
    // two separate pipes whose near ends coincide (as after dragging one onto
    // the other): weld collapses the two end nodes into one
    const d = createEmptyDesign('d', 'Weld');
    d.nodes.push(
      { id: 'a0', position: V(0, 0, 0) },
      { id: 'a1', position: V(1, 0, 0) },
      { id: 'b0', position: V(1, 0, 0) }, // coincident with a1
      { id: 'b1', position: V(1, 0, 1) },
    );
    d.members.push(
      { id: 'ma', kind: 'straight', nodeA: 'a0', nodeB: 'a1', size: '3/4"' },
      { id: 'mb', kind: 'straight', nodeA: 'b0', nodeB: 'b1', size: '3/4"' },
    );
    const out = weldNodes(d, 'b0', 'a1');
    expect(out.nodes.find((n) => n.id === 'b0')).toBeUndefined();
    expect(out.nodes).toHaveLength(3);
    // both pipes now share node a1
    expect(out.members.find((m) => m.id === 'mb')?.nodeA).toBe('a1');
    expect(out.members.find((m) => m.id === 'ma')?.nodeB).toBe('a1');
  });

  it('collapses overlapping joints when welding (no double pivot)', () => {
    // each pipe carries a wrapped joint at its near end; after welding the two
    // ends the joints share a node with the same member pair → deduped to one
    const d = createEmptyDesign('d', 'WeldJoints');
    d.nodes.push(
      { id: 'a0', position: V(0, 0, 0) },
      { id: 'a1', position: V(1, 0, 0) },
      { id: 'b0', position: V(1, 0, 0) },
      { id: 'b1', position: V(1, 0, 1) },
    );
    d.members.push(
      { id: 'ma', kind: 'straight', nodeA: 'a0', nodeB: 'a1', size: '3/4"' },
      { id: 'mb', kind: 'straight', nodeA: 'b0', nodeB: 'b1', size: '3/4"' },
    );
    d.joints.push(
      { id: 'j1', nodeId: 'a1', receiver: 'mb', mover: 'ma', onBody: false, mode: 'wrapped' },
      { id: 'j2', nodeId: 'b0', receiver: 'ma', mover: 'mb', onBody: false, mode: 'wrapped' },
    );
    const out = weldNodes(d, 'b0', 'a1');
    // both joints now at a1 for the same {ma, mb} pair → collapsed to one
    expect(out.joints).toHaveLength(1);
  });

  it('drops a member that collapses to zero length', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const [a, b] = [
      design.members.find((m) => m.id === memberIds[0])!.nodeA,
      design.members.find((m) => m.id === memberIds[0])!.nodeB,
    ];
    // welding a member's own two ends removes it
    const out = weldNodes(design, b, a);
    expect(out.members).toHaveLength(0);
  });
});

describe('measurements', () => {
  it('adds, offsets, and removes a tape measure; length tracks pinned nodes', () => {
    const { design, memberIds } = drawPath([V(0, 0, 0), V(1, 0, 0)]);
    const m = design.members.find((x) => x.id === memberIds[0])!;
    const added = addMeasurement(design, { nodeId: m.nodeA }, { nodeId: m.nodeB }, 0);
    expect(added.design.measurements).toHaveLength(1);
    expect(measurementLengthM(added.design, added.design.measurements[0]!)).toBeCloseTo(1, 9);

    const offset = setMeasurementOffset(added.design, added.measurementId, 0.1);
    expect(offset.measurements[0]?.offsetM).toBe(0.1);

    // a free-point measure reports the straight-line distance
    const free = addMeasurement(design, { position: V(0, 0, 0) }, { position: V(3, 4, 0) }, 0);
    expect(measurementLengthM(free.design, free.design.measurements[0]!)).toBeCloseTo(5, 9);

    const removed = removeMeasurement(offset, added.measurementId);
    expect(removed.measurements).toHaveLength(0);
  });

  it('measurePerp is horizontal and perpendicular to the axis', () => {
    const perp = measurePerp(V(0, 0, 0), V(1, 0, 0));
    expect(perp.y).toBe(0);
    expect(perp.x * 1 + perp.y * 0 + perp.z * 0).toBeCloseTo(0, 9); // ⟂ to +X
  });
});
