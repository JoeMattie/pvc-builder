import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type FormedMember, type Vec3 } from '../schema';
import { analyzeFormed, MIN_BEND_RADIUS_FACTOR } from './formed';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A formed member A→controlPoints→B on a fresh design. */
function formedDesign(
  a: Vec3,
  controlPoints: Vec3[],
  b: Vec3,
  filletRadiiM?: number[],
  size: '1/2"' | '3/4"' = '1/2"',
): { design: Design; member: FormedMember } {
  const design = createEmptyDesign('d', 'formed');
  design.nodes.push({ id: 'a', position: a }, { id: 'b', position: b });
  const member: FormedMember = {
    id: 'm',
    kind: 'formed',
    nodeA: 'a',
    nodeB: 'b',
    controlPoints,
    size,
    filletRadiiM,
  };
  design.members.push(member);
  return { design, member };
}

describe('analyzeFormed', () => {
  it('developed length matches the analytic fillet formula (reuse pipe.test)', () => {
    // right-angle corner through (1,0,0), fillet r=0.1 → shortens by
    // r·(2·tan(φ/2) − φ) with φ = π/2  (≈ 0.0429204)
    const { design, member } = formedDesign(V(0, 0, 0), [V(1, 0, 0)], V(1, 1, 0), [0.1]);
    const a = analyzeFormed(design, member)!;
    expect(a.chordLengthM).toBeCloseTo(2, 9);
    expect(a.developedLengthM).toBeCloseTo(2 - 0.1 * (2 * Math.tan(Math.PI / 4) - Math.PI / 2), 9);
  });

  it('reports the deflection angle at each bend', () => {
    const { design, member } = formedDesign(V(0, 0, 0), [V(1, 0, 0)], V(1, 1, 0));
    const a = analyzeFormed(design, member)!;
    expect(a.bends).toHaveLength(1);
    expect(a.bends[0]!.deflectionRad).toBeCloseTo(Math.PI / 2, 9);
  });

  it('carries the fabrication twist (dihedral) between successive bends', () => {
    // planar U → both dihedrals 0 (same bend plane)
    const { design, member } = formedDesign(V(0, 0, 0), [V(1, 0, 0), V(1, 1, 0)], V(0, 1, 0));
    const a = analyzeFormed(design, member)!;
    expect(a.bends.map((b) => b.dihedralRad)).toEqual([0, 0]);
  });

  it('flags a bend tighter than the heat-form minimum radius', () => {
    const { design, member } = formedDesign(V(0, 0, 0), [V(1, 0, 0)], V(1, 1, 0), [0.03], '1/2"');
    const a = analyzeFormed(design, member)!;
    // min radius = OD × 3 ≈ 0.064 m > 0.03 → tight
    expect(a.minBendRadiusM).toBeGreaterThan(0.03);
    expect(a.bends[0]!.belowMin).toBe(true);
    expect(a.hasTightBend).toBe(true);
  });

  it('does not flag a generous bend radius', () => {
    const { design, member } = formedDesign(V(0, 0, 0), [V(1, 0, 0)], V(1, 1, 0), [0.2]);
    expect(analyzeFormed(design, member)!.hasTightBend).toBe(false);
  });

  it('uses the OD × factor minimum radius', () => {
    const { design, member } = formedDesign(V(0, 0, 0), [V(1, 0, 0)], V(1, 1, 0), [], '3/4"');
    const a = analyzeFormed(design, member)!;
    expect(a.minBendRadiusM).toBeCloseTo(0.02667 * MIN_BEND_RADIUS_FACTOR, 6);
  });
});
