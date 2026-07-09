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

  it('the T-rex examples share one full-detail quad wireframe', () => {
    const rigid = EXAMPLES.find((e) => e.id === 'trex-rigid')!.load();
    const pivots = EXAMPLES.find((e) => e.id === 'trex-pivots')!.load();
    // tris→quads keeps every welded vertex (262) and stays well above the old
    // over-decimated 145-pipe cut; both variants share the same wireframe
    expect(rigid.nodes.length).toBe(262);
    expect(rigid.members.length).toBe(541);
    expect(rigid.joints).toHaveLength(0); // rigid: default couplings/conflicts
    expect(pivots.nodes.length).toBe(rigid.nodes.length);
    expect(pivots.members.length).toBe(rigid.members.length);
    // a free ball hub at every node with ≥2 incident pipes
    expect(pivots.joints.every((j) => j.mode === 'free' && !j.onBody)).toBe(true);
    expect(pivots.joints.length).toBeGreaterThan(500);
  });

  it('the rigid T-rex produces a cut list (BOM stays pure on a large mesh)', () => {
    const rigid = EXAMPLES.find((e) => e.id === 'trex-rigid')!.load();
    const b = bom(rigid);
    expect(b.cuts.length).toBe(rigid.members.length);
  });
});
