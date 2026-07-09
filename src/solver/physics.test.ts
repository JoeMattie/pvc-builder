import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import {
  lowestExtentM,
  physicsNodePositions,
  simGroundY,
  startPhysics,
  stepPhysics,
  stopPhysics,
} from './physics';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function pipeAt(y: number): Design {
  const d = createEmptyDesign('d', 'p');
  d.nodes.push({ id: 'a', position: V(-0.3, y, 0) }, { id: 'b', position: V(0.3, y, 0) });
  d.members.push({ id: 'm', kind: 'straight', nodeA: 'a', nodeB: 'b', size: '3/4"' });
  return d;
}

/** An L of two welded pipes meeting at a corner (a rigid union). */
function elbowAt(y: number): Design {
  const d = createEmptyDesign('d', 'L');
  d.nodes.push(
    { id: 'a', position: V(-0.3, y, 0) },
    { id: 'c', position: V(0, y, 0) },
    { id: 'b', position: V(0, y, 0.3) },
  );
  d.members.push(
    { id: 'm0', kind: 'straight', nodeA: 'a', nodeB: 'c', size: '3/4"' },
    { id: 'm1', kind: 'straight', nodeA: 'c', nodeB: 'b', size: '3/4"' },
  );
  return d;
}

afterEach(() => stopPhysics());

describe('physics (CrashCat)', () => {
  it('a free pipe falls under gravity', () => {
    startPhysics(pipeAt(1));
    const y0 = physicsNodePositions().a!.y;
    for (let i = 0; i < 30; i++) stepPhysics(1 / 60);
    const y1 = physicsNodePositions().a!.y;
    expect(y1).toBeLessThan(y0 - 0.01);
  });

  it('settles resting on the floor (never falls through)', () => {
    startPhysics(pipeAt(1));
    for (let i = 0; i < 400; i++) stepPhysics(1 / 60);
    const a = physicsNodePositions().a!;
    // rests on top of the y=0 floor at roughly the pipe radius, not below it
    expect(a.y).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(0.1);
  });

  it('preserves the pipe length as a rigid body', () => {
    startPhysics(pipeAt(1));
    for (let i = 0; i < 120; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    const len = Math.hypot(p.a!.x - p.b!.x, p.a!.y - p.b!.y, p.a!.z - p.b!.z);
    expect(len).toBeCloseTo(0.6, 2);
  });

  it('a welded union is one rigid body — settles without exploding, lengths kept', () => {
    startPhysics(elbowAt(1));
    for (let i = 0; i < 400; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    // both legs keep their length (the union stays rigid)
    expect(Math.hypot(p.a!.x - p.c!.x, p.a!.y - p.c!.y, p.a!.z - p.c!.z)).toBeCloseTo(0.3, 2);
    expect(Math.hypot(p.b!.x - p.c!.x, p.b!.y - p.c!.y, p.b!.z - p.c!.z)).toBeCloseTo(0.3, 2);
    // it settled near the floor, not flung away (no constraint eruption)
    for (const n of [p.a!, p.b!, p.c!]) {
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.y).toBeGreaterThan(-0.1);
      expect(Math.hypot(n.x, n.z)).toBeLessThan(1.5);
    }
  });

  it('a pipe starting centred on the ground does not erupt (floor is lowered)', () => {
    startPhysics(pipeAt(0)); // half the pipe is below y=0 at the start
    for (let i = 0; i < 200; i++) stepPhysics(1 / 60);
    const a = physicsNodePositions().a!;
    // it barely settles onto the lowered floor instead of being blasted upward
    expect(a.y).toBeLessThan(0.05);
    expect(a.y).toBeGreaterThan(-0.1);
  });
});

/** A bent (formed) pipe elevated at height `y`. */
function formedAt(y: number): Design {
  const d = createEmptyDesign('d', 'bent');
  d.nodes.push({ id: 'a', position: V(-0.3, y, 0) }, { id: 'b', position: V(0.3, y, 0) });
  d.members.push({
    id: 'm',
    kind: 'formed',
    nodeA: 'a',
    nodeB: 'b',
    controlPoints: [V(0, y, 0.2)],
    filletRadiiM: [0.06],
    size: '3/4"',
  });
  return d;
}

/** A tilted receiver with a pipe wrapped on its midpoint (on-body wrapped pivot). */
function wrappedRig(): Design {
  const d = createEmptyDesign('d', 'wrap');
  d.nodes.push(
    { id: 'r0', position: V(0, 1.2, 0) },
    { id: 'r1', position: V(2, 0.8, 0) }, // tilted receiver
    { id: 'w', position: V(1, 1.0, 0) }, // wrap node on the receiver midpoint
    { id: 'mf', position: V(1, 0.3, 0) }, // mover hangs down
  );
  d.members.push(
    { id: 'recv', kind: 'straight', nodeA: 'r0', nodeB: 'r1', size: '3/4"' },
    { id: 'mov', kind: 'straight', nodeA: 'w', nodeB: 'mf', size: '3/4"' },
  );
  d.joints.push({
    id: 'j',
    nodeId: 'w',
    receiver: 'recv',
    mover: 'mov',
    onBody: true,
    mode: 'wrapped',
  });
  return d;
}

describe('formed pipes + wrapped sliding', () => {
  it('a bent pipe is STATIC in sim — stays put under gravity', () => {
    startPhysics(formedAt(1));
    const y0 = physicsNodePositions().a!.y;
    for (let i = 0; i < 120; i++) stepPhysics(1 / 60);
    const y1 = physicsNodePositions().a!.y;
    expect(y1).toBeCloseTo(y0, 3); // did not fall — a static rigid body
  });

  it('a wrapped pivot stays on the receiver line while simulating (cylindrical joint)', () => {
    startPhysics(wrappedRig());
    for (let i = 0; i < 120; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    // perpendicular distance of the wrap node from the receiver segment
    const a = p.r0!;
    const b = p.w!;
    const c = p.r1!;
    const ab = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const t =
      ((b.x - a.x) * ab.x + (b.y - a.y) * ab.y + (b.z - a.z) * ab.z) /
      (ab.x * ab.x + ab.y * ab.y + ab.z * ab.z || 1);
    const cp = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
    const perp = Math.hypot(b.x - cp.x, b.y - cp.y, b.z - cp.z);
    expect(Number.isFinite(perp)).toBe(true);
    expect(perp).toBeLessThan(0.08); // the wrap stayed ON the pipe (not flung off)
  });
});

describe('ground extent helpers', () => {
  it('lowestExtentM is the lowest point minus the pipe radius', () => {
    const odM = 0.02667; // 3/4" OD
    expect(lowestExtentM(pipeAt(0.5))).toBeCloseTo(0.5 - odM / 2, 4);
  });

  it('simGroundY stays at 0 when nothing dips below, else just under the model', () => {
    expect(simGroundY(pipeAt(1))).toBe(0); // well above ground → floor stays at 0
    const low = simGroundY(pipeAt(0)); // dips below → floor drops just under it
    expect(low).toBeLessThan(0);
    expect(low).toBeGreaterThan(-0.05);
  });
});
