// Full rigid-body physics (CrashCat) for Play mode. Each welded ASSEMBLY (the
// same union-find rigid body the kinematics uses) is ONE dynamic compound body
// of capsules — so overlapping capsules at a union can't fight a constraint —
// pivots are hinge (wrapped) / point (free) constraints with friction, pipes
// never collide with each other (only the ground), and the ground is a static
// box temporarily lowered just below the model so nothing starts penetrating.
// Advanced in fixed substeps with CCD + a velocity cap so thin pipes don't
// tunnel the floor. Stateful (the world persists across frames), unlike the pure
// kinematic solve(); the two coexist (kinematics for exact locked posing,
// physics for dynamic simulation). This handles closed loops (a pivoted square
// collapses like a real parallelogram) that tree kinematics can't.
import {
  addBroadphaseLayer,
  addObjectLayer,
  box,
  capsule,
  createWorld,
  createWorldSettings,
  disableCollision,
  enableCollision,
  hingeConstraint,
  MotionQuality,
  MotionType,
  pointConstraint,
  registerAll,
  rigidBody,
  staticCompound,
  updateWorld,
  type World,
} from 'crashcat';
import { add, cross, dot, length, normalize, rotate, scale, sub } from '../geometry/math3';
import { type Design, pipeSpec, type Quaternion, type Vec3 } from '../schema';

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const GRAVITY = 9.81;
const DENSITY = 1400; // PVC ≈ 1400 kg/m³
// Physics engines are tuned for ~metre-scale objects; PVC pipe is ~1 cm radius,
// so the default contact slop lets it sink into the floor. Simulate at SCALE×
// (with gravity scaled to match) and divide positions back, so the geometry is
// engine-friendly and the motion still reads at real speed.
const SCALE = 20;
const PIVOT_FRICTION_TORQUE = 40; // scaled N·m — light resistance, swings under load
// Fixed-substep integration: thin PVC capsules on a static floor tunnel through
// at a coarse frame dt, so we advance the world in small fixed steps (plus CCD +
// a velocity cap on the bodies) for stable, non-penetrating contacts.
const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8; // cap catch-up steps per frame (no spiral of death)
const MAX_LINEAR_VELOCITY = 30 * SCALE; // scaled m/s — keeps a fall from tunnelling
// The physics floor sits this far below the lowest object at sim start, so
// nothing begins penetrating the ground (which otherwise erupts on the 1st step).
const GROUND_CLEARANCE_M = 0.003;

const v3 = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];
const s3 = (v: Vec3): [number, number, number] => [v.x * SCALE, v.y * SCALE, v.z * SCALE];

/** Unit quaternion rotating unit vector `a` onto unit vector `b`. */
function quatFromTo(a: Vec3, b: Vec3): Quaternion {
  const d = dot(a, b);
  if (d > 0.999999) return { x: 0, y: 0, z: 0, w: 1 };
  if (d < -0.999999) {
    let axis = cross({ x: 1, y: 0, z: 0 }, a);
    if (length(axis) < 1e-6) axis = cross({ x: 0, y: 1, z: 0 }, a);
    axis = normalize(axis);
    return { x: axis.x, y: axis.y, z: axis.z, w: 0 };
  }
  const c = cross(a, b);
  const w = 1 + d;
  const l = Math.hypot(c.x, c.y, c.z, w);
  return { x: c.x / l, y: c.y / l, z: c.z / l, w: w / l };
}
const conj = (q: Quaternion): Quaternion => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

interface Sim {
  world: World;
  bodyOfMember: Map<string, number>;
  /** per node: an incident member body + the node's offset in that body's frame */
  nodeSource: Map<string, { memberId: string; local: Vec3 }>;
  topoHash: string;
  /** leftover time (s) carried between frames for fixed-substep integration */
  accumulator: number;
}

let sim: Sim | null = null;

/** Rebuild the sim when the topology or rest geometry changes. */
export function physicsTopoHash(design: Design): string {
  return JSON.stringify({ m: design.members, j: design.joints, n: design.nodes });
}

function endpoints(design: Design, m: Design['members'][number]): { a: Vec3; b: Vec3 } | null {
  const a = design.nodes.find((n) => n.id === m.nodeA)?.position;
  const b = design.nodes.find((n) => n.id === m.nodeB)?.position;
  return a && b ? { a, b } : null;
}

/** The lowest point of any pipe (endpoint or formed control point, minus its
 * radius) in metres — the bottom extent of the whole model. Infinity → empty. */
export function lowestExtentM(design: Design): number {
  let lowest = Number.POSITIVE_INFINITY;
  const nodeY = (id: string): number | undefined =>
    design.nodes.find((n) => n.id === id)?.position.y;
  for (const m of design.members) {
    const r = pipeSpec(m.size).odM / 2;
    const ya = nodeY(m.nodeA);
    const yb = nodeY(m.nodeB);
    if (ya !== undefined) lowest = Math.min(lowest, ya - r);
    if (yb !== undefined) lowest = Math.min(lowest, yb - r);
    if (m.kind === 'formed') for (const cp of m.controlPoints) lowest = Math.min(lowest, cp.y - r);
  }
  return Number.isFinite(lowest) ? lowest : 0;
}

/** Y (metres) of the physics/visual floor for a sim run: at the design ground
 * (0) normally, or just below the model when it dips beneath it — so nothing
 * starts intersecting the ground. Shared by the sim and the rendered grid. */
export function simGroundY(design: Design): number {
  return Math.min(0, lowestExtentM(design) - GROUND_CLEARANCE_M);
}

/** World-space unit direction of a wrapped joint's receiver pipe at its node
 * (the hinge axis). The physics world is built at the design rest pose. */
function receiverDir(design: Design, joint: Design['joints'][number]): Vec3 {
  const recv = design.members.find((m) => m.id === joint.receiver);
  if (!recv) return UP;
  const e = endpoints(design, recv);
  if (!e) return UP;
  const d = recv.nodeB === joint.nodeId ? sub(e.a, e.b) : sub(e.b, e.a);
  return length(d) < 1e-9 ? UP : normalize(d);
}

function build(design: Design): Sim {
  registerAll();
  const settings = createWorldSettings();
  settings.gravity = [0, -GRAVITY * SCALE, 0];
  const bpMoving = addBroadphaseLayer(settings);
  const bpStatic = addBroadphaseLayer(settings);
  const olMoving = addObjectLayer(settings, bpMoving);
  const olStatic = addObjectLayer(settings, bpStatic);
  enableCollision(settings, olMoving, olStatic);
  // pipes never collide with each OTHER — only the ground. Members of one rigid
  // assembly are a single compound body (their capsules overlap at unions by
  // design), and members across a pivot overlap at the joint node; either way the
  // joint constraints hold them, so pipe-vs-pipe contacts are only spurious jitter.
  disableCollision(settings, olMoving, olMoving);
  const world = createWorld(settings);

  // ground: a large static box, temporarily lowered so its top face sits just
  // below the lowest object (nothing starts penetrating). Top face y = groundTop.
  const groundTop = simGroundY(design);
  rigidBody.create(world, {
    motionType: MotionType.STATIC,
    shape: box.create({ halfExtents: [50 * SCALE, SCALE, 50 * SCALE] }),
    objectLayer: olStatic,
    position: [0, groundTop * SCALE - SCALE, 0],
    friction: 0.9,
  });

  const bodyOfMember = new Map<string, number>();
  const nodeSource = new Map<string, { memberId: string; local: Vec3 }>();
  const nodePos = new Map(design.nodes.map((n) => [n.id, n.position]));
  const memberById = new Map(design.members.map((m) => [m.id, m]));

  // ── weld members into rigid ASSEMBLIES (union-find), mirroring the kinematics:
  // members sharing a node weld together (except a pivot's mover), and an on-body
  // anchor welds its branch into the run. Each assembly becomes ONE compound
  // rigid body — so overlapping capsules at a union can't fight a fixed
  // constraint, and one body's sub-shapes never self-collide.
  const parent = new Map<string, string>();
  for (const m of design.members) parent.set(m.id, m.id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const pivotMover = new Set<string>();
  for (const j of design.joints) if (j.mode !== 'anchor') pivotMover.add(`${j.nodeId}|${j.mover}`);
  const incident = new Map<string, string[]>();
  for (const m of design.members)
    for (const nid of [m.nodeA, m.nodeB])
      (incident.get(nid) ?? incident.set(nid, []).get(nid)!).push(m.id);
  for (const [nid, mem] of incident) {
    const weldable = mem.filter((mid) => !pivotMover.has(`${nid}|${mid}`));
    for (let i = 1; i < weldable.length; i++) union(weldable[0]!, weldable[i]!);
  }
  for (const j of design.joints) if (j.mode === 'anchor') union(j.receiver, j.mover);

  // group members by assembly root (skip members with no valid geometry)
  const assemblies = new Map<string, string[]>();
  for (const m of design.members) {
    if (!endpoints(design, m)) continue;
    const root = find(m.id);
    (assemblies.get(root) ?? assemblies.set(root, []).get(root)!).push(m.id);
  }

  const capsuleFor = (m: Design['members'][number], len: number) => {
    const r = (pipeSpec(m.size).odM / 2) * SCALE;
    return capsule.create({
      halfHeightOfCylinder: Math.max((len / 2) * SCALE - r, 0.01),
      radius: r,
      density: DENSITY,
    });
  };

  for (const memberIds of assemblies.values()) {
    const segs = memberIds
      .map((id) => {
        const m = memberById.get(id)!;
        const e = endpoints(design, m)!;
        const along = sub(e.b, e.a);
        const len = length(along);
        return len < 1e-4
          ? null
          : { id, m, dir: normalize(along), len, mid: scale(add(e.a, e.b), 0.5) };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    if (!segs.length) continue;

    // assembly centroid (world m) → the body origin
    const centroid = scale(
      segs.reduce((acc, s) => add(acc, s.mid), { x: 0, y: 0, z: 0 }),
      1 / segs.length,
    );

    const common = {
      motionType: MotionType.DYNAMIC,
      // continuous collision so a fast-falling thin pipe can't tunnel the floor
      motionQuality: MotionQuality.LINEAR_CAST,
      maxLinearVelocity: MAX_LINEAR_VELOCITY,
      objectLayer: olMoving,
      friction: 0.8,
      linearDamping: 0.05,
      angularDamping: 0.15,
    } as const;

    let bodyPos: [number, number, number];
    let bodyQuat: [number, number, number, number];
    let body: ReturnType<typeof rigidBody.create>;
    if (segs.length === 1) {
      const s = segs[0]!;
      const q = quatFromTo(UP, s.dir);
      bodyPos = s3(s.mid);
      bodyQuat = [q.x, q.y, q.z, q.w];
      body = rigidBody.create(world, {
        ...common,
        shape: capsuleFor(s.m, s.len),
        position: bodyPos,
        quaternion: bodyQuat,
      });
    } else {
      bodyPos = s3(centroid);
      bodyQuat = [0, 0, 0, 1];
      const children = segs.map((s) => {
        const q = quatFromTo(UP, s.dir);
        const p = s3(sub(s.mid, centroid));
        return {
          position: p as [number, number, number],
          quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number],
          shape: capsuleFor(s.m, s.len),
        };
      });
      body = rigidBody.create(world, {
        ...common,
        shape: staticCompound.create({ children }),
        position: bodyPos,
        quaternion: bodyQuat,
      });
    }
    for (const id of memberIds) bodyOfMember.set(id, body.id);

    // each node's offset in the body's local frame, for reading positions back
    const qc = conj({ x: bodyQuat[0], y: bodyQuat[1], z: bodyQuat[2], w: bodyQuat[3] });
    const bodyPosV: Vec3 = { x: bodyPos[0], y: bodyPos[1], z: bodyPos[2] };
    for (const s of segs) {
      for (const nid of [s.m.nodeA, s.m.nodeB]) {
        if (nodeSource.has(nid)) continue;
        const np = nodePos.get(nid);
        if (!np) continue;
        const worldOff = sub(scale(np, SCALE), bodyPosV);
        nodeSource.set(nid, { memberId: s.id, local: rotate(qc, worldOff) });
      }
    }
  }

  // pivots: wrapped → hinge about the receiver axis, free → point (ball); anchor
  // joints are welds and were folded into a compound body above (no constraint)
  for (const j of design.joints) {
    if (j.mode === 'anchor') continue;
    const ba = bodyOfMember.get(j.receiver);
    const bb = bodyOfMember.get(j.mover);
    const pos = nodePos.get(j.nodeId);
    if (ba === undefined || bb === undefined || !pos || ba === bb) continue;
    if (j.mode === 'free') {
      pointConstraint.create(world, { bodyIdA: ba, bodyIdB: bb, pointA: s3(pos), pointB: s3(pos) });
      continue;
    }
    const axis = receiverDir(design, j);
    let normalA = cross(axis, UP);
    if (length(normalA) < 1e-6) normalA = cross(axis, { x: 1, y: 0, z: 0 });
    normalA = normalize(normalA);
    hingeConstraint.create(world, {
      bodyIdA: ba,
      bodyIdB: bb,
      pointA: s3(pos),
      pointB: s3(pos),
      hingeAxisA: v3(axis),
      hingeAxisB: v3(axis),
      normalAxisA: v3(normalA),
      normalAxisB: v3(normalA),
      maxFrictionTorque: PIVOT_FRICTION_TORQUE,
    });
  }

  return { world, bodyOfMember, nodeSource, topoHash: physicsTopoHash(design), accumulator: 0 };
}

export function startPhysics(design: Design): void {
  sim = build(design);
}
export function stopPhysics(): void {
  sim = null;
}
export function physicsActive(): boolean {
  return sim !== null;
}
export function activeTopoHash(): string {
  return sim?.topoHash ?? '';
}

/** Advance the simulation in fixed substeps (stable contacts, no tunnelling).
 * Leftover time carries to the next frame; a long stall is clamped so it can't
 * spiral into an unbounded catch-up. */
export function stepPhysics(dt: number): void {
  if (!sim) return;
  sim.accumulator = Math.min(sim.accumulator + dt, MAX_SUBSTEPS * FIXED_DT);
  let steps = 0;
  while (sim.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    updateWorld(sim.world, undefined, FIXED_DT);
    sim.accumulator -= FIXED_DT;
    steps++;
  }
}

/** Current world node positions from the simulated bodies. */
export function physicsNodePositions(): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  if (!sim) return out;
  for (const [nodeId, src] of sim.nodeSource) {
    const id = sim.bodyOfMember.get(src.memberId);
    if (id === undefined) continue;
    const body = rigidBody.get(sim.world, id);
    if (!body) continue;
    const p = body.position;
    const q = body.quaternion;
    // body + rotated local offset are in SCALED space → divide back to metres
    const scaled = add(
      { x: p[0], y: p[1], z: p[2] },
      rotate({ x: q[0], y: q[1], z: q[2], w: q[3] }, src.local),
    );
    out[nodeId] = scale(scaled, 1 / SCALE);
  }
  return out;
}
