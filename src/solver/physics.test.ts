import { afterEach, describe, expect, it } from 'vitest';
import { wrapAllowanceM } from '../design/bom';
import { createEmptyDesign, type Design, pipeSpec, type Vec3 } from '../schema';
import {
  lowestExtentM,
  physicsFormedControlPoints,
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
  it('a bent pipe is a DYNAMIC rigid body — falls under gravity, keeps its shape', () => {
    startPhysics(formedAt(1));
    const y0 = physicsNodePositions().a!.y;
    const spread0 = Math.hypot(
      physicsNodePositions().a!.x - physicsNodePositions().b!.x,
      physicsNodePositions().a!.z - physicsNodePositions().b!.z,
    );
    for (let i = 0; i < 60; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    expect(p.a!.y).toBeLessThan(y0 - 0.05); // fell under gravity (physics applied)
    // the chord span is preserved (rigid — the bend didn't deform)
    const spread1 = Math.hypot(p.a!.x - p.b!.x, p.a!.z - p.b!.z);
    expect(spread1).toBeCloseTo(spread0, 1);
  });

  it('formed control points ride the rigid body (move, and keep node distances)', () => {
    const d = formedAt(1);
    const doc = d.members[0]!;
    const docCp = (doc.kind === 'formed' ? doc.controlPoints[0] : undefined)!;
    const docA = d.nodes.find((n) => n.id === 'a')!.position;
    const docB = d.nodes.find((n) => n.id === 'b')!.position;
    const dist = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    startPhysics(d);
    // at start (no steps) the control points read back at their doc positions
    const cp0 = physicsFormedControlPoints().m![0]!;
    expect(dist(cp0, docCp)).toBeLessThan(1e-6);
    for (let i = 0; i < 60; i++) stepPhysics(1 / 60);
    const cps = physicsFormedControlPoints().m!;
    expect(cps).toHaveLength(1);
    const cp = cps[0]!;
    // (a) the bend MOVED from its doc position (it fell with the body)
    expect(dist(cp, docCp)).toBeGreaterThan(0.05);
    expect(cp.y).toBeLessThan(docCp.y - 0.05);
    // (b) rigid-body invariant: its distance to each endpoint is preserved
    const p = physicsNodePositions();
    expect(dist(cp, p.a!)).toBeCloseTo(dist(docCp, docA), 2);
    expect(dist(cp, p.b!)).toBeCloseTo(dist(docCp, docB), 2);
  });

  it('formed control points ride a WELDED assembly (compound body) too', () => {
    // a formed member welded to a straight one at a shared node → one compound
    const d = createEmptyDesign('d', 'bent-weld');
    d.nodes.push(
      { id: 'a', position: V(-0.3, 1, 0) },
      { id: 'b', position: V(0.3, 1, 0) },
      { id: 'c', position: V(0.6, 1, 0.3) },
    );
    d.members.push(
      {
        id: 'mf',
        kind: 'formed',
        nodeA: 'a',
        nodeB: 'b',
        controlPoints: [V(0, 1, 0.2)],
        filletRadiiM: [0.06],
        size: '3/4"',
      },
      { id: 'ms', kind: 'straight', nodeA: 'b', nodeB: 'c', size: '3/4"' },
    );
    const dist = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    startPhysics(d);
    for (let i = 0; i < 60; i++) stepPhysics(1 / 60);
    const cp = physicsFormedControlPoints().mf![0]!;
    const p = physicsNodePositions();
    expect(cp.y).toBeLessThan(1 - 0.05); // fell with the assembly
    // rigid across the whole weld: distances to BOTH members' nodes preserved
    expect(dist(cp, p.a!)).toBeCloseTo(dist(V(0, 1, 0.2), V(-0.3, 1, 0)), 2);
    expect(dist(cp, p.c!)).toBeCloseTo(dist(V(0, 1, 0.2), V(0.6, 1, 0.3)), 2);
  });

  it('physicsFormedControlPoints is empty when no sim is active', () => {
    stopPhysics();
    expect(physicsFormedControlPoints()).toEqual({});
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

/** Two separate horizontal pipes with an elastic band between their FAR ends
 * (far apart, so the band is pre-tensioned and should pull them together). */
function twoPipesWithBand(stiffness: number): Design {
  const d = createEmptyDesign('d', 'band');
  d.nodes.push(
    { id: 'a0', position: V(-0.6, 0.5, 0) },
    { id: 'a1', position: V(-0.3, 0.5, 0) },
    { id: 'b1', position: V(0.3, 0.5, 0) },
    { id: 'b0', position: V(0.6, 0.5, 0) },
  );
  d.members.push(
    { id: 'ma', kind: 'straight', nodeA: 'a0', nodeB: 'a1', size: '3/4"' },
    { id: 'mb', kind: 'straight', nodeA: 'b1', nodeB: 'b0', size: '3/4"' },
  );
  d.elastics.push({
    id: 'el',
    a: { nodeId: 'a1' },
    b: { nodeId: 'b1' },
    restLengthM: 0.1,
    stiffnessNPerM: stiffness,
  });
  return d;
}

describe('elastic bands', () => {
  const gap = (p: Record<string, Vec3>): number =>
    Math.hypot(p.a1!.x - p.b1!.x, p.a1!.y - p.b1!.y, p.a1!.z - p.b1!.z);

  it('a pre-tensioned band pulls two pipes together, staying finite + bounded', () => {
    startPhysics(twoPipesWithBand(150));
    const g0 = gap(physicsNodePositions());
    for (let i = 0; i < 120; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    const g1 = gap(p);
    expect(g1).toBeLessThan(g0 - 0.05); // measurably closer
    for (const n of Object.values(p)) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)).toBe(true);
      expect(Math.hypot(n.x, n.y, n.z)).toBeLessThan(5); // no explosion
    }
  });

  it('a limp band (0 N/m) leaves the horizontal gap unchanged', () => {
    startPhysics(twoPipesWithBand(0));
    const g0 = gap(physicsNodePositions());
    for (let i = 0; i < 120; i++) stepPhysics(1 / 60);
    expect(Math.abs(gap(physicsNodePositions()) - g0)).toBeLessThan(0.15);
  });
});

/** A horizontal pipe hovering above the mannequin's shoulders/head, so it drops
 * onto the mannequin (when enabled) instead of falling to the floor. */
function pipeOverMannequin(mannequin: boolean): Design {
  const d = createEmptyDesign('d', 'rest');
  d.mannequin = mannequin;
  // spans x∈[−0.3,0.3] at y=1.9 (clear of the head top ≈1.72), across the shoulders
  d.nodes.push({ id: 'a', position: V(-0.3, 1.9, 0) }, { id: 'b', position: V(0.3, 1.9, 0) });
  d.members.push({ id: 'm', kind: 'straight', nodeA: 'a', nodeB: 'b', size: '3/4"' });
  return d;
}

describe('static mannequin collision body (schema v9)', () => {
  it('a pipe rests on the mannequin instead of falling to the floor', () => {
    startPhysics(pipeOverMannequin(true));
    for (let i = 0; i < 250; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    const minY = Math.min(p.a!.y, p.b!.y);
    expect(minY).toBeGreaterThan(0.8); // caught high up on the human body
    for (const n of [p.a!, p.b!]) expect(Number.isFinite(n.y)).toBe(true);
  });

  it('without the mannequin the same pipe falls to the floor', () => {
    startPhysics(pipeOverMannequin(false));
    for (let i = 0; i < 250; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    expect(Math.min(p.a!.y, p.b!.y)).toBeLessThan(0.2); // hit the ground
  });
});

/** Two far-apart pipes joined by a pre-tensioned band (so the band pulls them
 * together), with an optional global damping multiplier. */
function bandRig(jointDamping?: number): Design {
  const d = createEmptyDesign('d', 'damp');
  if (jointDamping !== undefined) d.jointDamping = jointDamping;
  d.nodes.push(
    { id: 'a0', position: V(-0.9, 0.5, 0) },
    { id: 'a1', position: V(-0.6, 0.5, 0) },
    { id: 'b1', position: V(0.6, 0.5, 0) },
    { id: 'b0', position: V(0.9, 0.5, 0) },
  );
  d.members.push(
    { id: 'ma', kind: 'straight', nodeA: 'a0', nodeB: 'a1', size: '3/4"' },
    { id: 'mb', kind: 'straight', nodeA: 'b1', nodeB: 'b0', size: '3/4"' },
  );
  d.elastics.push({
    id: 'e',
    a: { nodeId: 'a1' },
    b: { nodeId: 'b1' },
    restLengthM: 0.1,
    stiffnessNPerM: 100,
  });
  return d;
}

describe('joint/elastic damping multiplier (schema v9)', () => {
  // converged gap between the two band ends after `n` frames (starts at 1.2 m);
  // the sim is deterministic, so this is reproducible.
  const gapAfter = (damping: number | undefined, n: number): number => {
    startPhysics(bandRig(damping));
    for (let i = 0; i < n; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    const g = Math.hypot(p.a1!.x - p.b1!.x, p.a1!.y - p.b1!.y, p.a1!.z - p.b1!.z);
    stopPhysics();
    return g;
  };

  it('the damping multiplier measurably changes the pull', () => {
    // Sampled MID-FLIGHT (60 frames): pipes now collide, so by ~90 frames the
    // lightly-damped rig is contact-clamped tip-to-tip and both variants
    // converge to the same contact-resting gap — the damping difference shows
    // in how fast the band closes the gap, not in the final clamped distance.
    const light = gapAfter(0.2, 60);
    const heavy = gapAfter(5, 60);
    // both finite/bounded, and the 25× damping change moves the in-flight gap
    expect(Number.isFinite(light) && Number.isFinite(heavy)).toBe(true);
    for (const g of [light, heavy]) expect(g).toBeLessThan(5);
    expect(Math.abs(heavy - light)).toBeGreaterThan(0.02);
  });

  it('is identical at damping 1 vs undefined (no regression)', () => {
    expect(gapAfter(1, 250)).toBeCloseTo(gapAfter(undefined, 250), 3);
  });
});

const OD = pipeSpec('3/4"').odM; // 0.02667

/** Two UNJOINED perpendicular pipes, `upper` crossing above `lower`'s midpoint. */
function crossedPipes(lowerY: number, upperY: number): Design {
  const d = createEmptyDesign('d', 'stack');
  d.nodes.push(
    { id: 'la', position: V(-0.4, lowerY, 0) },
    { id: 'lb', position: V(0.4, lowerY, 0) },
    { id: 'ua', position: V(0, upperY, -0.4) },
    { id: 'ub', position: V(0, upperY, 0.4) },
  );
  d.members.push(
    { id: 'ml', kind: 'straight', nodeA: 'la', nodeB: 'lb', size: '3/4"' },
    { id: 'mu', kind: 'straight', nodeA: 'ua', nodeB: 'ub', size: '3/4"' },
  );
  return d;
}

describe('pipe-pipe collision (on by default)', () => {
  const midY = (p: Record<string, Vec3>, a: string, b: string) => (p[a]!.y + p[b]!.y) / 2;

  it('(a) two separate assemblies dropped one above the other settle STACKED', () => {
    // upper starts well clear of the lower (no build-time overlap → they collide)
    startPhysics(crossedPipes(0.2, 0.5));
    for (let i = 0; i < 400; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    for (const n of Object.values(p)) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)).toBe(true);
      expect(Math.hypot(n.x, n.y, n.z)).toBeLessThan(3); // no explosion
    }
    const lower = midY(p, 'la', 'lb');
    const upper = midY(p, 'ua', 'ub');
    expect(lower).toBeGreaterThan(0); // lower rests on the floor
    expect(lower).toBeLessThan(0.05);
    // upper rests ON the lower: centre-to-centre ≈ one OD (touching cylinders),
    // neither interpenetrated nor bounced away
    expect(upper - lower).toBeGreaterThan(0.7 * OD);
    expect(upper - lower).toBeLessThan(1.6 * OD);
  });

  it('pipes ALREADY interpenetrating at build coexist (pair snapshot-filtered)', () => {
    // same crossing but at the SAME height → penetrating by a full OD at build;
    // the pair is vetoed, so both settle THROUGH each other flat on the floor
    startPhysics(crossedPipes(0.5, 0.5));
    for (let i = 0; i < 400; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    for (const n of Object.values(p)) {
      expect(Number.isFinite(n.y)).toBe(true);
      expect(Math.hypot(n.x, n.y, n.z)).toBeLessThan(3); // no eruption from the overlap
    }
    // BOTH rest at floor level (~one radius); a colliding pair would stack one
    // pipe a full OD higher (see the stacking test above)
    expect(midY(p, 'la', 'lb')).toBeLessThan(0.025);
    expect(midY(p, 'ua', 'ub')).toBeLessThan(0.025);
  });

  it('(c) constraint-connected pairs generate no contacts — an overlapping wrapped mover does not explode', () => {
    // mover lies almost PARALLEL along its receiver (deep capsule overlap the
    // whole way): if the pivot pair produced contacts this would erupt instantly
    const d = createEmptyDesign('d', 'overlap-pivot');
    d.nodes.push(
      { id: 'r0', position: V(-1, 0.6, 0) },
      { id: 'r1', position: V(1, 0.6, 0) },
      { id: 'w', position: V(0, 0.6, 0) },
      { id: 'mf', position: V(0.9, 0.62, 0) },
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
    startPhysics(d);
    for (let i = 0; i < 240; i++) stepPhysics(1 / 60);
    const p = physicsNodePositions();
    for (const n of Object.values(p)) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)).toBe(true);
      expect(Math.hypot(n.x, n.y, n.z)).toBeLessThan(3); // posed near contact, no explosion
    }
    // the joint held: the wrap node is still on the receiver segment
    const a = p.r0!;
    const b = p.w!;
    const c = p.r1!;
    const ab = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const t =
      ((b.x - a.x) * ab.x + (b.y - a.y) * ab.y + (b.z - a.z) * ab.z) /
      (ab.x * ab.x + ab.y * ab.y + ab.z * ab.z || 1);
    const cp = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
    expect(Math.hypot(b.x - cp.x, b.y - cp.y, b.z - cp.z)).toBeLessThan(0.08);
  });
});

/** A sawhorse: a tilted receiver welded onto two floor-standing legs (with feet),
 * a wrap sliding on the receiver near the HIGH end, and an on-body anchor (a
 * screwed tee with a branch) mid-run below it. Gravity drags the hanging mover
 * down-slope toward the tee. */
function slideStopRig(): Design {
  const d = createEmptyDesign('d', 'slide-stop');
  d.nodes.push(
    { id: 'r0', position: V(0, 1.5, 0) },
    { id: 'r1', position: V(2, 0.5, 0) },
    { id: 'w', position: V(0.5, 1.25, 0) }, // wrap at t=0.25 along the receiver
    { id: 'mf', position: V(0.5, 0.55, 0) }, // mover hangs 0.7 m down
    { id: 'tee', position: V(1.5, 0.75, 0) }, // on-body anchor at t=0.75
    { id: 'tb', position: V(1.5, 0.75, 0.4) }, // its branch (horizontal, out of plane)
    // legs + feet so the frame stands still on the floor
    { id: 'g0', position: V(0, 0.014, 0) },
    { id: 'g1', position: V(2, 0.014, 0) },
    { id: 'f0a', position: V(0, 0.014, -0.3) },
    { id: 'f0b', position: V(0, 0.014, 0.3) },
    { id: 'f1a', position: V(2, 0.014, -0.3) },
    { id: 'f1b', position: V(2, 0.014, 0.3) },
  );
  d.members.push(
    { id: 'recv', kind: 'straight', nodeA: 'r0', nodeB: 'r1', size: '3/4"' },
    { id: 'mov', kind: 'straight', nodeA: 'w', nodeB: 'mf', size: '3/4"' },
    { id: 'branch', kind: 'straight', nodeA: 'tee', nodeB: 'tb', size: '3/4"' },
    { id: 'leg0', kind: 'straight', nodeA: 'r0', nodeB: 'g0', size: '3/4"' },
    { id: 'leg1', kind: 'straight', nodeA: 'r1', nodeB: 'g1', size: '3/4"' },
    { id: 'foot0a', kind: 'straight', nodeA: 'g0', nodeB: 'f0a', size: '3/4"' },
    { id: 'foot0b', kind: 'straight', nodeA: 'g0', nodeB: 'f0b', size: '3/4"' },
    { id: 'foot1a', kind: 'straight', nodeA: 'g1', nodeB: 'f1a', size: '3/4"' },
    { id: 'foot1b', kind: 'straight', nodeA: 'g1', nodeB: 'f1b', size: '3/4"' },
  );
  d.joints.push(
    { id: 'jw', nodeId: 'w', receiver: 'recv', mover: 'mov', onBody: true, mode: 'wrapped' },
    { id: 'jt', nodeId: 'tee', receiver: 'recv', mover: 'branch', onBody: true, mode: 'anchor' },
  );
  return d;
}

describe('(b) sliding wrap stops at obstructions on its receiver', () => {
  it('slides down-slope and hard-stops one hardware clearance short of the tee', () => {
    // the same documented-estimate clearance build() uses (mover OD/2 + wrap allowance)
    const clearance = OD / 2 + wrapAllowanceM('3/4"');
    startPhysics(slideStopRig());
    const along = (p: Record<string, Vec3>): number => {
      // distance of the wrap node from the tee node, along the LIVE receiver axis
      const ax = p.r1!.x - p.r0!.x;
      const ay = p.r1!.y - p.r0!.y;
      const az = p.r1!.z - p.r0!.z;
      const al = Math.hypot(ax, ay, az) || 1;
      return ((p.tee!.x - p.w!.x) * ax + (p.tee!.y - p.w!.y) * ay + (p.tee!.z - p.w!.z) * az) / al;
    };
    const d0 = along(physicsNodePositions());
    expect(d0).toBeGreaterThan(1.0); // starts ~1.12 m up-slope of the tee
    let minAlong = d0;
    for (let i = 0; i < 400; i++) {
      stepPhysics(1 / 60);
      minAlong = Math.min(minAlong, along(physicsNodePositions()));
    }
    const dEnd = along(physicsNodePositions());
    // it slid measurably down-slope…
    expect(d0 - dEnd).toBeGreaterThan(0.3);
    // …came to rest AT the stop (gravity keeps pushing it against the limit)…
    expect(dEnd).toBeLessThan(clearance + 0.15);
    // …and NEVER passed the clearance stop, at any sampled frame
    expect(minAlong).toBeGreaterThan(clearance - 0.02);
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
