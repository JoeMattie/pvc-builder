import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, pipeSpec, type Vec3 } from '../schema';
import {
  bom,
  bomToCsv,
  type CutItem,
  cutSourceSummary,
  EYE_BOLT_TAKEOFF_M,
  endCapAllowanceM,
  fittingTakeoffDetail,
  fittingTakeoffM,
  STOCK_LENGTH_M,
  stockNeeds,
  wrapAllowanceM,
} from './bom';
import { addFormedMember, appendPipe, setJoinMode, startPath } from './docOps';

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
const IN = 0.0254;

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

  it('uses sourced pipeSpec take-off metadata where available', () => {
    const detail = fittingTakeoffDetail('elbow90', '3/4"');
    expect(detail.valueM).toBeCloseTo((9 / 16) * IN, 9);
    expect(detail.source.basis).toBe('sourced');
    expect(detail.source.label).toMatch(/Spears/);
    expect(pipeSpec('3/4"').fittingTakeoffs?.teeRun?.source.basis).toBe('sourced');

    const b = bom(path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]));
    expect(cutSourceSummary(cut(b, 0)).join(' ')).toContain('sourced: Spears');
  });

  it('sums total pipe by size', () => {
    const b = bom(path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)], '1/2"'));
    const t = fittingTakeoffM('elbow90', '1/2"');
    expect(b.totalBySize['1/2"']).toBeCloseTo(2 * (1 - t), 9);
  });
});

describe('bom joint hardware', () => {
  it('counts a wrapped pivot as heat-wrap hardware (no socket fitting)', () => {
    const d = path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = d.nodes[1]!.id;
    const withPivot = setJoinMode(d, corner, d.members[0]!.id, 'wrapped');
    const b = bom(withPivot);
    expect(b.joints).toEqual([{ mode: 'wrapped', count: 1 }]);
    // the pivoted corner is no longer an elbow fitting
    expect(b.fittings.find((f) => f.type === 'elbow90')).toBeUndefined();
  });

  it('a free pivot lists eye-bolt hardware and takes a bit off each butted end', () => {
    const d = path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const corner = d.nodes[1]!.id;
    const withFree = setJoinMode(d, corner, d.members[0]!.id, 'free');
    const b = bom(withFree);
    expect(b.joints).toEqual([{ mode: 'free', count: 1 }]);
    // both pipes butt the ball at the corner → each shortened by the eye-bolt take-off
    expect(cut(b, 0).cutLengthM).toBeCloseTo(1 - EYE_BOLT_TAKEOFF_M, 9);
    expect(cut(b, 1).cutLengthM).toBeCloseTo(1 - EYE_BOLT_TAKEOFF_M, 9);
    const csv = bomToCsv(withFree);
    expect(csv).toContain('free pivot');
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
    expect(cut(b, 0).bendSchedule?.[0]).toMatchObject({ bend: 1, belowMin: true });
    expect(b.warnings.some((w) => w.severity === 'fabrication')).toBe(true);
  });
});

describe('wrapped-union fabrication allowances', () => {
  it('adds a wrap allowance to the mover + an end cap to the receiver end', () => {
    // an L: two 3/4" pipes meeting end-to-end; make it a wrapped pivot
    let d = path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const mid = d.nodes[1]!.id; // shared corner
    const mB = d.members[1]!.id;
    d = setJoinMode(d, mid, mB, 'wrapped'); // mB wraps the other pipe (receiver auto-picked)
    const b = bom(d);
    const j = d.joints.find((jj) => jj.mode === 'wrapped')!;
    const mover = b.cuts.find((c) => c.memberId === j.mover)!;
    const receiver = b.cuts.find((c) => c.memberId === j.receiver)!;
    // mover carries the wrap allowance
    expect(mover.wrapAllowanceM).toBeCloseTo(wrapAllowanceM('3/4"'), 9);
    expect(mover.wrapAllowanceSource.basis).toBe('estimate');
    // the joint is at the receiver's own endpoint → it gets an end cap
    expect(receiver.endCapM).toBeCloseTo(endCapAllowanceM('3/4"'), 9);
    expect(receiver.endCapSource.basis).toBe('estimate');
    // cut length includes the allowance (base + extra)
    expect(mover.cutLengthM).toBeGreaterThan(mover.spanM - mover.takeoffAM - mover.takeoffBM);
    expect(b.warnings.some((w) => w.message.includes('wrap allowance'))).toBe(true);
  });

  it('allowances are zero without a wrapped joint', () => {
    const b = bom(path([V(0, 0, 0), V(1, 0, 0)]));
    expect(b.cuts[0]!.wrapAllowanceM).toBe(0);
    expect(b.cuts[0]!.endCapM).toBe(0);
  });
});

describe('manufactured on-body union splits the run', () => {
  // a 2 m run with a branch tee'd onto its middle as a MANUFACTURED union → the
  // intact run must be cut into two pieces to insert the socket tee
  function branchedRun(manufactured: boolean): Design {
    const base = createEmptyDesign('d', 'p');
    return {
      ...base,
      nodes: [
        { id: 'a', position: V(0, 0, 0) },
        { id: 'b', position: V(2, 0, 0) },
        { id: 'm', position: V(1, 0, 0) }, // on the run centre-line
        { id: 't', position: V(1, 0, 1) }, // branch tip
      ],
      members: [
        { id: 'run', kind: 'straight', nodeA: 'a', nodeB: 'b', size: '3/4"' },
        { id: 'branch', kind: 'straight', nodeA: 'm', nodeB: 't', size: '3/4"' },
      ],
      joints: [
        {
          id: 'j',
          nodeId: 'm',
          receiver: 'run',
          mover: 'branch',
          onBody: true,
          mode: 'anchor',
          ...(manufactured ? { manufactured: true } : {}),
        },
      ],
    };
  }

  it('cuts the run into two tee-take-off pieces', () => {
    const runCuts = bom(branchedRun(true)).cuts.filter((c) => c.memberId === 'run');
    const tee = fittingTakeoffM('tee', '3/4"');
    expect(runCuts.length).toBe(2);
    expect(runCuts.map((c) => c.segment)).toEqual([0, 1]);
    for (const c of runCuts) {
      expect(c.spanM).toBeCloseTo(1, 9); // split at the middle
      expect(c.cutLengthM).toBeCloseTo(1 - tee, 9); // open run end + tee socket end
    }
    // total run material is conserved vs. the un-split (minus the two sockets)
    const total = runCuts.reduce((s, c) => s + c.cutLengthM, 0);
    expect(total).toBeCloseTo(2 - 2 * tee, 9);
  });

  it('does NOT split a non-manufactured on-body union (stays one run)', () => {
    const runCuts = bom(branchedRun(false)).cuts.filter((c) => c.memberId === 'run');
    expect(runCuts.length).toBe(1);
    expect(runCuts[0]!.segment).toBeUndefined();
  });
});

describe('bomToCsv', () => {
  it('emits cut-list, fittings and totals sections', () => {
    const csv = bomToCsv(path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]));
    expect(csv).toMatch(/Cut list/);
    expect(csv).toMatch(/Fittings/);
    expect(csv).toMatch(/Total pipe by size/);
    expect(csv).toMatch(/elbow90/);
    expect(csv).toMatch(/Sources \/ assumptions/);
    expect(csv).toMatch(/sourced: Spears PVC White Schedule 40 fitting catalog/);
    expect(csv.trim().split('\n').length).toBeGreaterThan(5);
  });

  it('emits assumption warnings and formed bend schedules', () => {
    const formed = addFormedMember(
      createEmptyDesign('d', 'f'),
      V(0, 0, 0),
      V(1, 1, 0),
      [V(1, 0, 0)],
      '3/4"',
      [0.05],
    ).design;
    const formedCsv = bomToCsv(formed);
    expect(formedCsv).toContain('Bend schedule');
    expect(formedCsv).toContain('B1: bend');
    expect(formedCsv).toContain('Warnings');
    expect(formedCsv).toContain('below the recommended heat-forming minimum');

    const d = path([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]);
    const withFree = setJoinMode(d, d.nodes[1]!.id, d.members[0]!.id, 'free');
    const freeCsv = bomToCsv(withFree);
    expect(freeCsv).toContain('estimate: PVC Builder estimate');
    expect(freeCsv).toContain('free-pivot eye bolt');
  });
});

describe('stockNeeds (10-ft purchase list)', () => {
  const cut = (cutLengthM: number, size: '1/2"' | '3/4"' = '1/2"') =>
    ({ size, cutLengthM }) as CutItem;

  it('packs cuts into sticks first-fit-decreasing', () => {
    // three 1.6 m cuts: no two fit one 3.048 m stick → 3 sticks
    const [need] = stockNeeds([cut(1.6), cut(1.6), cut(1.6)]);
    expect(need?.sticks).toBe(3);
    // 1.6 + 1.4 DO share a stick → 2 sticks for 1.6/1.6/1.4/1.4
    expect(stockNeeds([cut(1.6), cut(1.4), cut(1.6), cut(1.4)])[0]?.sticks).toBe(2);
  });

  it('separates sizes and reports waste', () => {
    const needs = stockNeeds([cut(1.0, '1/2"'), cut(1.0, '3/4"')]);
    expect(needs).toHaveLength(2);
    for (const n of needs) {
      expect(n.sticks).toBe(1);
      expect(n.wasteM).toBeCloseTo(STOCK_LENGTH_M - 1.0, 9);
    }
  });

  it('a cut longer than one stick buys whole sticks and packs the remainder', () => {
    // 7 m = 2 whole sticks + 0.904 m remainder → 3 sticks total
    expect(stockNeeds([cut(7)])[0]?.sticks).toBe(3);
    // remainder shares a stick with another short cut
    const [need] = stockNeeds([cut(7), cut(2.0)]);
    expect(need?.sticks).toBe(3);
  });

  it('is included in bom() and the CSV', () => {
    const start = startPath(createEmptyDesign('d', 's'), { x: 0, y: 0, z: 0 });
    const design = appendPipe(start.design, start.nodeId, { x: 1, y: 0, z: 0 }, '1/2"').design;
    const b = bom(design);
    expect(b.stock).toHaveLength(1);
    expect(b.stock[0]?.sticks).toBe(1);
    expect(bomToCsv(design)).toContain('Stock to buy');
  });
});
