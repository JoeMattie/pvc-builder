import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import { physicsNodePositions, startPhysics, stepPhysics, stopPhysics } from './physics';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function pipeAt(y: number): Design {
  const d = createEmptyDesign('d', 'p');
  d.nodes.push({ id: 'a', position: V(-0.3, y, 0) }, { id: 'b', position: V(0.3, y, 0) });
  d.members.push({ id: 'm', kind: 'straight', nodeA: 'a', nodeB: 'b', size: '3/4"' });
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
});
