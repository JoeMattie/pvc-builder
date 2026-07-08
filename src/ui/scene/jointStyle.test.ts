import { describe, expect, it } from 'vitest';
import { length, sub } from '../../geometry/math3';
import { createEmptyDesign, type Design, pipeSpec, type Vec3 } from '../../schema';
import { anchorRendersAsTee } from './jointStyle';
import { buildPipeModel } from './pipeModel';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

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
