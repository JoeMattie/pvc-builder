import { describe, expect, it } from 'vitest';
import { bom } from '../design/bom';
import { designSchema } from '../schema';
import { EXAMPLES } from './index';

describe('bundled examples', () => {
  it('every example loads and validates against the latest schema', () => {
    for (const ex of EXAMPLES) {
      const design = ex.load();
      const parsed = designSchema.safeParse(design);
      expect(parsed.success, `${ex.id}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('the T-rex examples share one pruned quad wireframe', () => {
    const rigid = EXAMPLES.find((e) => e.id === 'trex-rigid')!.load();
    const pivots = EXAMPLES.find((e) => e.id === 'trex-pivots')!.load();
    const wrapped = EXAMPLES.find((e) => e.id === 'trex-wrapped')!.load();
    // tris→quads keeps every welded vertex (262), then substantially-overlapping
    // pipes are pruned (541 → 520); all three variants share that wireframe
    expect(rigid.nodes.length).toBe(262);
    expect(rigid.members.length).toBe(520);
    expect(rigid.joints).toHaveLength(0); // rigid: default couplings/conflicts
    for (const v of [pivots, wrapped]) {
      expect(v.nodes.length).toBe(rigid.nodes.length);
      expect(v.members.length).toBe(rigid.members.length);
    }
    // a free ball hub at every node with ≥2 incident pipes
    expect(pivots.joints.every((j) => j.mode === 'free' && !j.onBody)).toBe(true);
    expect(pivots.joints.length).toBeGreaterThan(500);
    // wrapped: a random subset of non-pinned (swivel) connectors — fewer than the
    // full free set, all mode 'wrapped'
    expect(wrapped.joints.every((j) => j.mode === 'wrapped' && !j.onBody)).toBe(true);
    expect(wrapped.joints.length).toBeGreaterThan(0);
    expect(wrapped.joints.length).toBeLessThan(pivots.joints.length);
  });

  it('the Raptor Clone loads, wears the mannequin, and carries flex joints + elastics', () => {
    const clone = EXAMPLES.find((e) => e.id === 'raptor-clone')!.load();
    // a mannequin-wearing, tuned, unlocked doc
    expect(clone.mannequin).toBe(true);
    expect(clone.jointDamping).toBeGreaterThan(0);
    expect(clone.lengthsLocked).toBe(false);
    // wrapped flex joints + elastic suspension bands
    expect(clone.joints.length).toBeGreaterThan(0);
    expect(clone.elastics.length).toBeGreaterThan(0);
    expect(clone.members.length).toBeLessThan(800); // under the render cap
  });

  it('the rigid T-rex produces a cut list (BOM stays pure on a large mesh)', () => {
    const rigid = EXAMPLES.find((e) => e.id === 'trex-rigid')!.load();
    const b = bom(rigid);
    expect(b.cuts.length).toBe(rigid.members.length);
  });
});
