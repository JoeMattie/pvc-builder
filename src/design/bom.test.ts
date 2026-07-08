import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import { bom, bomToCsv, fittingTakeoffM } from './bom';
import { addFormedMember, appendPipe, startPath } from './docOps';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function path(points: Vec3[], size: '1/2"' | '3/4"' = '3/4"'): Design {
  let d = createEmptyDesign('d', 'p');
  const s = startPath(d, points[0]!);
  d = s.design;
  let from = s.nodeId;
  for (let i = 1; i < points.length; i++) {
    const r = appendPipe(d, from, points[i]!, size);
    d = r.design;
    from = r.nodeId;
  }
  return d;
}

const cut = (b: ReturnType<typeof bom>, i: number) => b.cuts[i]!;

describe('bom cut list', () => {
  it('a single open-ended pipe cuts to its full span (no take-off)', () => {
    const b = bom(path([V(0, 0, 0), V(1, 0, 0)]));
    expect(cut(b, 0).spanM).toBeCloseTo(1, 9);
    expect(cut(b, 0).cutLengthM).toBeCloseTo(1, 9);
    expect(cut(b, 0).takeoffAM).toBe(0);
  });

  it('a coupling butts at the centre — no take-off', () => {
    // three collinear points → two pipes joined by a coupling at the middle
    const b = bom(path([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]));
    const coupling = b.fittings.find((f) => f.type === 'coupling');
    expect(coupling?.count).toBe(1);
    for (const c of b.cuts) expect(c.cutLengthM).toBeCloseTo(1, 9);
  });

  it('subtracts an elbow take-off at a corner', () => {
    const b = bom(path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]));
    const t = fittingTakeoffM('elbow90', '3/4"');
    expect(t).toBeGreaterThan(0);
    // each pipe: 1 m span, open at the far end, elbow at the corner
    expect(cut(b, 0).cutLengthM).toBeCloseTo(1 - t, 9);
    expect(cut(b, 1).cutLengthM).toBeCloseTo(1 - t, 9);
  });

  it('sums total pipe by size', () => {
    const b = bom(path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)], '1/2"'));
    const t = fittingTakeoffM('elbow90', '1/2"');
    expect(b.totalBySize['1/2"']).toBeCloseTo(2 * (1 - t), 9);
  });
});

describe('bom fitting counts', () => {
  it('counts fittings by type and flags reducing joints', () => {
    // a reducing coupling: 3/4" meeting 1/2" in a straight run
    let d = createEmptyDesign('d', 'r');
    const s = startPath(d, V(0, 0, 0));
    d = s.design;
    const p1 = appendPipe(d, s.nodeId, V(1, 0, 0), '3/4"');
    d = p1.design;
    const p2 = appendPipe(d, p1.nodeId, V(2, 0, 0), '1/2"');
    d = p2.design;
    const reducer = bom(d).fittings.find((f) => f.type === 'reducer');
    expect(reducer?.count).toBe(1);
    expect(reducer?.reducing).toBe(true);
  });
});

describe('bom formed pipe', () => {
  it('uses developed length as the cut span and reports the bend schedule', () => {
    const d = addFormedMember(
      createEmptyDesign('d', 'f'),
      V(0, 0, 0),
      V(1, 1, 0),
      [V(1, 0, 0)],
      '3/4"',
      [0.05],
    ).design;
    const b = bom(d);
    expect(cut(b, 0).kind).toBe('formed');
    // developed < chord (2 m) because the fillet rounds the corner
    expect(cut(b, 0).spanM).toBeLessThan(2);
    expect(cut(b, 0).spanM).toBeGreaterThan(0);
    expect(cut(b, 0).bendsRad).toHaveLength(1);
  });
});

describe('bomToCsv', () => {
  it('emits cut-list, fittings and totals sections', () => {
    const csv = bomToCsv(path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]), 'imperial');
    expect(csv).toMatch(/Cut list/);
    expect(csv).toMatch(/Fittings/);
    expect(csv).toMatch(/Total pipe by size/);
    expect(csv).toMatch(/elbow90/);
    expect(csv.trim().split('\n').length).toBeGreaterThan(5);
  });
});
