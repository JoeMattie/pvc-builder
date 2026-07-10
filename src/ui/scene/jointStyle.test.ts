import { describe, expect, it } from 'vitest';
import { solveIntersections } from '../../design/solveIntersections';
import { length, sub } from '../../geometry/math3';
import {
  createEmptyDesign,
  type Design,
  type NominalSize,
  pipeSpec,
  type Vec3,
} from '../../schema';
import { anchorRendersAsHub, anchorRendersAsTee, junctionEndCount } from './jointStyle';
import { buildPipeModel } from './pipeModel';

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

/** Two pipes crossing at the origin, joined by `solveIntersections` (an X). */
function solvedX(): Design {
  return solveIntersections(
    straightDesign([
      { id: 'h', a: V(-0.5, 0, 0), b: V(0.5, 0, 0) },
      { id: 'v', a: V(0, 0, -0.5), b: V(0, 0, 0.5) },
    ]),
  ).design;
}

/** Four pipes through the origin at non-standard angles, solved. */
function solvedFourWay(): Design {
  const along = (deg: number, t: number): Vec3 => {
    const a = (deg * Math.PI) / 180;
    return V(Math.cos(a) * t, 0, Math.sin(a) * t);
  };
  return solveIntersections(
    straightDesign([
      { id: 'a', a: along(0, -0.5), b: along(0, 0.5) },
      { id: 'b', a: along(45, -0.5), b: along(45, 0.5) },
      { id: 'c', a: along(105, -0.5), b: along(105, 0.5) },
      { id: 'e', a: along(150, -0.5), b: along(150, 0.5) },
    ]),
  ).design;
}

/** A run along +X plus a branch that ends on the run at the origin, tee'd off
 * as an on-body ANCHOR. `branchFar` sets the branch angle. */
function onBodyAnchor(branchFar: Vec3, onBody = true): Design {
  const d = createEmptyDesign('t', 'tee');
  d.nodes.push(
    { id: 'r0', position: V(-0.3, 0, 0) },
    { id: 'r1', position: V(0.3, 0, 0) },
    { id: 'bf', position: branchFar },
    { id: 'bn', position: V(0, 0, 0) },
  );
  d.members.push(
    { id: 'run', kind: 'straight', nodeA: 'r0', nodeB: 'r1', size: '3/4"' },
    { id: 'branch', kind: 'straight', nodeA: 'bf', nodeB: 'bn', size: '3/4"' },
  );
  d.joints.push({
    id: 'j0',
    nodeId: 'bn',
    receiver: 'run',
    mover: 'branch',
    onBody,
    mode: 'anchor',
  });
  return d;
}

describe('anchorRendersAsTee', () => {
  it('is a tee when a rigid on-body branch meets the run at ~90°', () => {
    const perp = onBodyAnchor(V(0, 0, 0.3));
    expect(anchorRendersAsTee(perp, perp.joints[0]!)).toBe(true);
    // a few degrees off 90° still reads as a tee
    const near = onBodyAnchor(V(0.03, 0, 0.3));
    expect(anchorRendersAsTee(near, near.joints[0]!)).toBe(true);
  });

  it('is NOT a tee at an arbitrary (non-90°) angle → wrap arrow', () => {
    const d = onBodyAnchor(V(0.2, 0, 0.2)); // 45°
    expect(anchorRendersAsTee(d, d.joints[0]!)).toBe(false);
  });

  it('is NOT a tee for a wrapped pivot or an end-to-end join', () => {
    const wrapped = onBodyAnchor(V(0, 0, 0.3));
    wrapped.joints[0]!.mode = 'wrapped';
    expect(anchorRendersAsTee(wrapped, wrapped.joints[0]!)).toBe(false);
    const endToEnd = onBodyAnchor(V(0, 0, 0.3), false);
    expect(anchorRendersAsTee(endToEnd, endToEnd.joints[0]!)).toBe(false);
  });
});

describe('junctionEndCount', () => {
  it('counts a lone on-body tee as exactly 3 ends (branch + through run)', () => {
    const d = onBodyAnchor(V(0, 0, 0.3));
    expect(junctionEndCount(d, 'bn')).toBe(3);
  });

  it('counts a solved X crossing as 4 ends and a solved 4-way as 8', () => {
    const x = solvedX();
    expect(junctionEndCount(x, x.joints[0]!.nodeId)).toBe(4);
    const four = solvedFourWay();
    expect(junctionEndCount(four, four.joints[0]!.nodeId)).toBe(8);
  });
});

describe('anchorRendersAsHub (fabricated many-way union → brown sphere)', () => {
  it('a lone 90° on-body union stays a tee, not a hub', () => {
    const d = onBodyAnchor(V(0, 0, 0.3));
    expect(anchorRendersAsHub(d, d.joints[0]!)).toBe(false);
    expect(anchorRendersAsTee(d, d.joints[0]!)).toBe(true);
  });

  it('a solved X crossing (4 ends) is a hub, never a tee — even at 90°', () => {
    const d = solvedX();
    const jt = d.joints[0]!;
    expect(anchorRendersAsHub(d, jt)).toBe(true);
    expect(anchorRendersAsTee(d, jt)).toBe(false);
  });

  it('every anchor of a solved many-way crossing is a hub (one sphere per node)', () => {
    const d = solvedFourWay();
    expect(d.joints.length).toBeGreaterThan(0);
    for (const jt of d.joints) {
      expect(jt.mode).toBe('anchor');
      expect(anchorRendersAsHub(d, jt)).toBe(true);
      expect(anchorRendersAsTee(d, jt)).toBe(false);
    }
  });

  it('a wrapped pivot is never a hub (anchor clusters only)', () => {
    const d = solvedX();
    d.joints[0] = { ...d.joints[0]!, mode: 'wrapped' };
    expect(anchorRendersAsHub(d, d.joints[0]!)).toBe(false);
  });

  it('a solved 3-end no-through-run union (end-to-end records) is a hub', () => {
    // three pipes ENDING at one node at odd angles — no straight run exists;
    // solveIntersections covers it with end-to-end fabricated anchor records
    const dir = (deg: number, t: number): Vec3 => {
      const a = (deg * Math.PI) / 180;
      return V(Math.cos(a) * t, 0, Math.sin(a) * t);
    };
    const base = straightDesign([{ id: 'a', a: dir(0, 0.4), b: V(0, 0, 0) }]);
    base.nodes.push({ id: 'fb', position: dir(100, 0.4) }, { id: 'fc', position: dir(210, 0.4) });
    base.members.push(
      { id: 'b', kind: 'straight', nodeA: 'n1', nodeB: 'fb', size: '3/4"' },
      { id: 'c', kind: 'straight', nodeA: 'n1', nodeB: 'fc', size: '3/4"' },
    );
    const d = solveIntersections(base).design;
    expect(d.joints.length).toBe(2);
    expect(junctionEndCount(d, 'n1')).toBe(3);
    for (const jt of d.joints) {
      expect(jt.onBody).toBe(false);
      expect(anchorRendersAsHub(d, jt)).toBe(true); // 3 ends, no run → brown hub
      expect(anchorRendersAsTee(d, jt)).toBe(false);
    }
  });

  it('hub pipes run FULL into the sphere — no pull-back gap at the junction', () => {
    const d = solvedX();
    const node = d.joints[0]!.nodeId;
    const nodePos = d.nodes.find((n) => n.id === node)!.position;
    // the intact receiver passes through; every incident stub reaches the node
    const model = buildPipeModel(d);
    for (const m of d.members) {
      for (const [nid, end] of [
        [m.nodeA, 'a'],
        [m.nodeB, 'b'],
      ] as const) {
        if (nid !== node) continue;
        const cyl = model.cylinders.find((c) => c.memberId === m.id)!;
        expect(length(sub(cyl[end], nodePos))).toBeLessThan(1e-9);
      }
    }
  });
});

describe('pipeModel pull-back at rigid unions', () => {
  const branchEnd = (d: Design): Vec3 => {
    const cyl = buildPipeModel(d).cylinders.find((c) => c.memberId === 'branch')!;
    return cyl.b; // the on-body (bn) end
  };

  it('a 90° tee branch reaches the run node in full (no pull-back, hub sleeves it)', () => {
    expect(length(sub(branchEnd(onBodyAnchor(V(0, 0, 0.3))), V(0, 0, 0)))).toBeLessThan(1e-9);
  });

  it('an off-angle rigid branch stops ~1" short of the run surface', () => {
    const gap = length(sub(branchEnd(onBodyAnchor(V(0.2, 0, 0.2))), V(0, 0, 0)));
    const expected = pipeSpec('3/4"').odM / 2 + 0.0254; // receiverR + 1"
    expect(gap).toBeCloseTo(expected, 4);
  });
});
