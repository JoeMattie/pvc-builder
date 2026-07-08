import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../schema';
import { easedPos, stepEasing } from './animStore';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const N = (id: string, p: Vec3) => [{ id, position: p }];

// The eased map is module-global; each test uses a unique id and inits it first.
describe('stepEasing', () => {
  it('snaps a brand-new node straight to its target (no fly-in)', () => {
    stepEasing(N('a', V(1, 2, 3)), 0.3, false);
    expect(easedPos('a')).toEqual(V(1, 2, 3));
  });

  it('eases toward a moved target partway, not instantly', () => {
    stepEasing(N('b', V(0, 0, 0)), 0.5, false); // init at origin
    const changed = stepEasing(N('b', V(1, 0, 0)), 0.5, false); // target → 1, alpha 0.5
    expect(changed).toBe(true);
    expect(easedPos('b')?.x).toBeCloseTo(0.5, 9); // halfway, not 1
  });

  it('converges onto the target over many steps', () => {
    stepEasing(N('c', V(0, 0, 0)), 0.3, false);
    for (let i = 0; i < 60; i++) stepEasing(N('c', V(1, 0, 0)), 0.3, false);
    expect(easedPos('c')?.x).toBeCloseTo(1, 9);
  });

  it('snaps in a single step when instant (large designs)', () => {
    stepEasing(N('d', V(0, 0, 0)), 0.3, false);
    stepEasing(N('d', V(5, 0, 0)), 0.3, true);
    expect(easedPos('d')).toEqual(V(5, 0, 0));
  });

  it('reports no change once settled', () => {
    stepEasing(N('e', V(2, 0, 0)), 0.3, false);
    expect(stepEasing(N('e', V(2, 0, 0)), 0.3, false)).toBe(false);
  });

  it('prunes nodes that are gone', () => {
    stepEasing(N('f', V(0, 0, 0)), 0.3, false);
    stepEasing([], 0.3, false);
    expect(easedPos('f')).toBeUndefined();
  });
});
