// Full rigid-body physics (CrashCat) for Play mode. Each pipe member is a
// dynamic capsule, welded joints are fixed constraints, pivots are hinge
// constraints with friction, and the ground is a static plane at y = 0 — all
// under gravity. Stateful (the world persists across frames), unlike the pure
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
  enableCollision,
  fixedConstraint,
  hingeConstraint,
  MotionType,
  registerAll,
  rigidBody,
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
const MAX_DT = 1 / 30;

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
}

let sim: Sim | null = null;

/** Rebuild the sim when the topology or rest geometry changes. */
export function physicsTopoHash(design: Design): string {
  return JSON.stringify({ m: design.members, p: design.pivots, n: design.nodes });
}

function endpoints(design: Design, m: Design['members'][number]): { a: Vec3; b: Vec3 } | null {
  const a = design.nodes.find((n) => n.id === m.nodeA)?.position;
  const b = design.nodes.find((n) => n.id === m.nodeB)?.position;
  return a && b ? { a, b } : null;
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
  const world = createWorld(settings);

  // ground: a large static box whose top face is y = 0 (scaled space)
  rigidBody.create(world, {
    motionType: MotionType.STATIC,
    shape: box.create({ halfExtents: [50 * SCALE, SCALE, 50 * SCALE] }),
    objectLayer: olStatic,
    position: [0, -SCALE, 0],
    friction: 0.9,
  });

  const bodyOfMember = new Map<string, number>();
  const nodeSource = new Map<string, { memberId: string; local: Vec3 }>();

  for (const m of design.members) {
    const e = endpoints(design, m);
    if (!e) continue;
    const along = sub(e.b, e.a);
    const len = length(along);
    if (len < 1e-4) continue;
    const dir = normalize(along);
    const mid = scale(add(e.a, e.b), 0.5);
    const r = (pipeSpec(m.size).odM / 2) * SCALE;
    const halfLen = (len / 2) * SCALE;
    const quat = quatFromTo(UP, dir); // capsule cylinder axis is +Y
    const body = rigidBody.create(world, {
      motionType: MotionType.DYNAMIC,
      shape: capsule.create({
        halfHeightOfCylinder: Math.max(halfLen - r, 0.01),
        radius: r,
        density: DENSITY,
      }),
      objectLayer: olMoving,
      position: s3(mid),
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      friction: 0.8,
      linearDamping: 0.05,
      angularDamping: 0.15,
    });
    bodyOfMember.set(m.id, body.id);
    // node offset in the body frame, in SCALED space
    const qc = conj(quat);
    if (!nodeSource.has(m.nodeA))
      nodeSource.set(m.nodeA, { memberId: m.id, local: rotate(qc, scale(sub(e.a, mid), SCALE)) });
    if (!nodeSource.has(m.nodeB))
      nodeSource.set(m.nodeB, { memberId: m.id, local: rotate(qc, scale(sub(e.b, mid), SCALE)) });
  }

  // welds (non-pivot shared nodes) → fixed constraints; pivots → hinges
  const pivotNodes = new Set(design.pivots.map((p) => p.nodeId));
  const incident = new Map<string, string[]>();
  for (const m of design.members)
    for (const nid of [m.nodeA, m.nodeB])
      (incident.get(nid) ?? incident.set(nid, []).get(nid)!).push(m.id);
  const nodePos = new Map(design.nodes.map((n) => [n.id, n.position]));

  for (const [nid, mem] of incident) {
    if (pivotNodes.has(nid) || mem.length < 2) continue;
    const pos = nodePos.get(nid);
    const b0 = bodyOfMember.get(mem[0]!);
    if (!pos || b0 === undefined) continue;
    for (let i = 1; i < mem.length; i++) {
      const bi = bodyOfMember.get(mem[i]!);
      if (bi !== undefined) {
        fixedConstraint.create(world, {
          bodyIdA: b0,
          bodyIdB: bi,
          point1: s3(pos),
          point2: s3(pos),
        });
      }
    }
  }

  for (const pv of design.pivots) {
    const ba = bodyOfMember.get(pv.memberA);
    const bb = bodyOfMember.get(pv.memberB);
    const pos = nodePos.get(pv.nodeId);
    if (ba === undefined || bb === undefined || !pos) continue;
    const axis = normalize(pv.axis);
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

  return { world, bodyOfMember, nodeSource, topoHash: physicsTopoHash(design) };
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

/** Advance the simulation (clamped so a long frame can't explode it). */
export function stepPhysics(dt: number): void {
  if (sim) updateWorld(sim.world, undefined, Math.min(dt, MAX_DT));
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
