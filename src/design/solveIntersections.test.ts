import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type NominalSize, type Vec3 } from '../schema';
import { nodeById } from './docOps';
import { resolveFittings } from './fittings';
import { analyzeFormed } from './formed';
import { intersectingMembers } from './intersections';
import { solveIntersections } from './solveIntersections';

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

describe('solveIntersections', () => {
  it('joins an X crossing (mid×mid) by splitting one member + an on-body anchor', () => {
    const d = straightDesign([
      { id: 'h', a: V(-0.5, 0, 0), b: V(0.5, 0, 0) },
      { id: 'v', a: V(0, 0, -0.5), b: V(0, 0, 0.5) },
    ]);
    expect(intersectingMembers(d).size).toBe(2);

    const r = solveIntersections(d);
    expect(r.joined).toBe(1);
    // one member split into two halves; the other stays intact as the run
    expect(r.design.members).toHaveLength(3);
    expect(r.design.joints).toHaveLength(1);
    const jt = r.design.joints[0]!;
    expect(jt.onBody).toBe(true);
    expect(jt.mode).toBe('anchor');
    expect(jt.receiver).toBe('v'); // the un-split member is the receiver
    // the junction node sits exactly at the crossing, on the receiver's line
    const n = nodeById(r.design, jt.nodeId)!;
    expect(n.position.x).toBeCloseTo(0, 9);
    expect(n.position.z).toBeCloseTo(0, 9);
    // the red flag is cleared and no fitting conflict appears
    expect(intersectingMembers(r.design).size).toBe(0);
    expect(resolveFittings(r.design).conflicts).toHaveLength(0);
  });

  it('joins a T crossing (endpoint on body) without splitting, snapping the end on-line', () => {
    const d = straightDesign([
      { id: 'run', a: V(-0.25, 0, 0), b: V(0.25, 0, 0) },
      // branch END stops 8 mm short of the run's centre-line — overlapping, not touching it
      { id: 'branch', a: V(0, 0, 0.2), b: V(0, 0, 0.008) },
    ]);
    expect(intersectingMembers(d).size).toBe(2);

    const r = solveIntersections(d);
    expect(r.joined).toBe(1);
    expect(r.design.members).toHaveLength(2); // no split
    expect(r.design.joints).toHaveLength(1);
    const jt = r.design.joints[0]!;
    expect(jt.onBody).toBe(true);
    expect(jt.mode).toBe('anchor');
    expect(jt.receiver).toBe('run');
    expect(jt.mover).toBe('branch');
    // the branch end was pulled exactly onto the run's centre-line
    const end = nodeById(r.design, jt.nodeId)!;
    expect(end.position.x).toBeCloseTo(0, 9);
    expect(end.position.y).toBeCloseTo(0, 9);
    expect(end.position.z).toBeCloseTo(0, 9);
    expect(intersectingMembers(r.design).size).toBe(0);
    expect(resolveFittings(r.design).conflicts).toHaveLength(0);
  });

  it('joins three pipes through one point at non-standard angles with no fitting conflicts', () => {
    const dir = (deg: number): Vec3 => {
      const a = (deg * Math.PI) / 180;
      return V(Math.cos(a), 0, Math.sin(a));
    };
    const along = (deg: number, t: number): Vec3 => {
      const u = dir(deg);
      return V(u.x * t, 0, u.z * t);
    };
    // three pipes crossing at the origin at 0° / 50° / 105° — no shared nodes
    const d = straightDesign([
      { id: 'a', a: along(0, -0.5), b: along(0, 0.5) },
      { id: 'b', a: along(50, -0.5), b: along(50, 0.5) },
      { id: 'c', a: along(105, -0.5), b: along(105, 0.5) },
    ]);
    const conflictsBefore = resolveFittings(d).conflicts.length;
    expect(intersectingMembers(d).size).toBe(3);

    const r = solveIntersections(d);
    expect(r.joined).toBe(2);
    // first crossing splits one member; the other two join at the SAME node
    expect(r.design.members).toHaveLength(4);
    expect(r.design.joints).toHaveLength(2);
    const [j1, j2] = r.design.joints as [
      (typeof r.design.joints)[number],
      (typeof r.design.joints)[number],
    ];
    expect(j1.nodeId).toBe(j2.nodeId); // one shared junction
    for (const jt of r.design.joints) {
      expect(jt.onBody).toBe(true);
      expect(jt.mode).toBe('anchor');
    }
    expect(intersectingMembers(r.design).size).toBe(0);
    // valid three-way heat-wrap: NO new fitting conflicts at odd angles
    expect(resolveFittings(r.design).conflicts.length).toBe(conflictsBefore);
  });

  it('joins FOUR pipes through one point — all tied to the same node, warning-free', () => {
    const along = (deg: number, t: number): Vec3 => {
      const a = (deg * Math.PI) / 180;
      return V(Math.cos(a) * t, 0, Math.sin(a) * t);
    };
    // four pipes crossing at the origin at 0° / 45° / 105° / 150° — no shared nodes
    const d = straightDesign([
      { id: 'a', a: along(0, -0.5), b: along(0, 0.5) },
      { id: 'b', a: along(45, -0.5), b: along(45, 0.5) },
      { id: 'c', a: along(105, -0.5), b: along(105, 0.5) },
      { id: 'e', a: along(150, -0.5), b: along(150, 0.5) },
    ]);
    const conflictsBefore = resolveFittings(d).conflicts.length;
    expect(intersectingMembers(d).size).toBe(4);

    const r = solveIntersections(d);
    // every OTHER pipe ties into the junction the first split created
    expect(r.joined).toBe(3);
    // two pipes split at the node (the host + the one past the free movers),
    // two stay intact with on-body anchor records
    expect(r.design.members).toHaveLength(6);
    expect(r.design.joints).toHaveLength(2);
    const nodeIds = new Set(r.design.joints.map((j) => j.nodeId));
    expect(nodeIds.size).toBe(1); // ONE shared junction
    for (const jt of r.design.joints) {
      expect(jt.onBody).toBe(true);
      expect(jt.mode).toBe('anchor');
    }
    // every member is tied to the junction: incident to the node or a receiver
    const nodeId = [...nodeIds][0]!;
    const tied = new Set<string>(r.design.joints.map((j) => j.receiver));
    for (const m of r.design.members) if (m.nodeA === nodeId || m.nodeB === nodeId) tied.add(m.id);
    expect(tied.size).toBe(r.design.members.length);
    // NO leftover red overlap, NO fitting conflicts, and a second run is a no-op
    expect(intersectingMembers(r.design).size).toBe(0);
    expect(resolveFittings(r.design).conflicts.length).toBe(conflictsBefore);
    const again = solveIntersections(r.design);
    expect(again.joined).toBe(0);
    expect(again.design).toBe(r.design);
  });

  it('welds two overlapping pipe ENDS at an odd angle and solves the corner as a BEND', () => {
    // two pipe ends overlap tip-to-tip at a non-standard angle (~140°)
    const a40 = (40 * Math.PI) / 180;
    const dir40 = V(Math.cos(a40), 0, Math.sin(a40));
    const d = straightDesign([
      { id: 'p1', a: V(-0.3, 0, 0), b: V(0, 0, 0) },
      {
        id: 'p2',
        a: V(0.005, 0, 0.005),
        b: V(0.005 + dir40.x * 0.25, 0, 0.005 + dir40.z * 0.25),
      },
    ]);
    expect(intersectingMembers(d).size).toBe(2);

    const r = solveIntersections(d);
    // pass 1 welds the ends (1); pass 2 merges the odd corner into a bend (1)
    expect(r.joined).toBe(2);
    // ONE heat-bent member remains, bent at the old junction
    expect(r.design.members).toHaveLength(1);
    const m = r.design.members[0]!;
    expect(m.kind).toBe('formed');
    // a tight FOLD: hug point → corner → hug point (hugs pin the spline)
    if (m.kind === 'formed') expect(m.controlPoints).toHaveLength(3);
    expect(r.design.joints).toHaveLength(0); // continuous pipe — no record needed
    expect(r.design.nodes).toHaveLength(2); // the corner node became the bend
    expect(intersectingMembers(r.design).size).toBe(0);
    expect(resolveFittings(r.design).conflicts).toHaveLength(0);
  });

  it('solves a nonstandard end-to-end corner (85°) as a heat-bent formed pipe', () => {
    // leg1 arrives along +X at the shared node n1; leg2 leaves so the two
    // OUTGOING directions sit at 85° — the "non-standard angle (85°)" conflict
    const a95 = (95 * Math.PI) / 180;
    const d = straightDesign([{ id: 'leg1', a: V(-0.4, 0, 0), b: V(0, 0, 0) }]);
    d.nodes.push({ id: 'nb', position: V(Math.cos(a95) * 0.35, 0, Math.sin(a95) * 0.35) });
    d.members.push({ id: 'leg2', kind: 'straight', nodeA: 'n1', nodeB: 'nb', size: '3/4"' });
    const before = resolveFittings(d);
    expect(before.conflicts).toHaveLength(1);
    expect(before.conflicts[0]!.reason).toContain('non-standard angle');

    const r = solveIntersections(d);
    expect(r.joined).toBe(1);
    expect(r.design.members).toHaveLength(1);
    const m = r.design.members[0]!;
    expect(m.kind).toBe('formed');
    if (m.kind !== 'formed') return;
    // the corner became a tight FOLD: hug → corner → hug; the node was pruned
    expect(m.controlPoints).toHaveLength(3);
    expect(m.controlPoints[1]!.x).toBeCloseTo(0, 9);
    expect(m.controlPoints[1]!.z).toBeCloseTo(0, 9);
    expect(r.design.nodes).toHaveLength(2);
    // developed length ≈ the two legs' sum (a crease loses almost nothing)
    const analysis = analyzeFormed(r.design, m);
    expect(analysis).not.toBeNull();
    const legSum = 0.4 + 0.35;
    expect(analysis!.developedLengthM).toBeGreaterThan(legSum * 0.98);
    expect(analysis!.developedLengthM).toBeLessThanOrEqual(legSum + 1e-9);
    // the schedule shows exactly ONE bend — the hug points are guide points
    // (sub-epsilon deflection), and a zero-fillet crease is deliberate, not
    // a tight-bend warning
    expect(analysis!.bends).toHaveLength(1);
    expect(analysis!.bends[0]!.filletRadiusM).toBe(0);
    expect(analysis!.hasTightBend).toBe(false);
    // warning-free + idempotent
    expect(resolveFittings(r.design).conflicts).toHaveLength(0);
    expect(intersectingMembers(r.design).size).toBe(0);
    const again = solveIntersections(r.design);
    expect(again.joined).toBe(0);
    expect(again.design).toBe(r.design);
  });

  it('covers three ends with NO straight run with a fabricated union — records, no conflicts', () => {
    // three pipes ENDING at one shared node (n1) at odd angles (0° / 100° / 210°)
    const dir = (deg: number, t: number): Vec3 => {
      const a = (deg * Math.PI) / 180;
      return V(Math.cos(a) * t, 0, Math.sin(a) * t);
    };
    const d = straightDesign([{ id: 'a', a: dir(0, 0.4), b: V(0, 0, 0) }]);
    d.nodes.push({ id: 'fb', position: dir(100, 0.4) }, { id: 'fc', position: dir(210, 0.4) });
    d.members.push(
      { id: 'b', kind: 'straight', nodeA: 'n1', nodeB: 'fb', size: '3/4"' },
      { id: 'c', kind: 'straight', nodeA: 'n1', nodeB: 'fc', size: '3/4"' },
    );
    const before = resolveFittings(d);
    expect(before.conflicts).toHaveLength(1);
    expect(before.conflicts[0]!.reason).toContain('no straight run');

    const r = solveIntersections(d);
    expect(r.joined).toBe(1);
    expect(r.design.members).toHaveLength(3); // geometry untouched
    // one fabricated anchor record per non-receiver member, all end-to-end
    expect(r.design.joints).toHaveLength(2);
    for (const jt of r.design.joints) {
      expect(jt.nodeId).toBe('n1');
      expect(jt.mode).toBe('anchor');
      expect(jt.onBody).toBe(false);
    }
    expect(resolveFittings(r.design).conflicts).toHaveLength(0);
    const again = solveIntersections(r.design);
    expect(again.joined).toBe(0);
    expect(again.design).toBe(r.design);
  });

  it('is idempotent: a second run joins nothing and returns the design unchanged', () => {
    const d = straightDesign([
      { id: 'h', a: V(-0.5, 0, 0), b: V(0.5, 0, 0) },
      { id: 'v', a: V(0, 0, -0.5), b: V(0, 0, 0.5) },
      { id: 'branch', a: V(0.2, 0, 0.3), b: V(0.2, 0, 0.005) },
    ]);
    const first = solveIntersections(d);
    expect(first.joined).toBe(2);
    expect(intersectingMembers(first.design).size).toBe(0);

    const second = solveIntersections(first.design);
    expect(second.joined).toBe(0);
    expect(second.design).toBe(first.design); // untouched, same reference
  });

  it('returns the design unchanged when nothing overlaps', () => {
    const d = straightDesign([
      { id: 'a', a: V(0, 0, 0), b: V(1, 0, 0) },
      { id: 'b', a: V(0, 0, 0.5), b: V(1, 0, 0.5) },
    ]);
    const r = solveIntersections(d);
    expect(r.joined).toBe(0);
    expect(r.design).toBe(d);
  });
});
