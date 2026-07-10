// Full rigid-body physics (CrashCat) for Play mode. Each welded ASSEMBLY (the
// same union-find rigid body the kinematics uses) is ONE dynamic compound body
// of capsules — so overlapping capsules at a union can't fight a constraint —
// pivots are cylindrical 6DOF (wrapped: spin + slide along the receiver, with
// friction, hard-stopped at the fittings/joints it would hit) / point (free)
// constraints, bent pipes are dynamic rigid bodies (one compound each), pipes
// COLLIDE with each other (bodies of different assemblies stack and rest on one
// another) EXCEPT constraint-connected pairs and pairs that already interpenetrate
// at build (see the exclusion-set machinery in build()), the ground a static
// box temporarily lowered just below the model so nothing starts penetrating.
// EXPERIMENT (branch sim-precision-rollback): the fixed-substep + CCD + velocity
// cap precision (added to stop thin pipes tunnelling the floor) is rolled back to
// one coarse step per frame, to see if that precision is still needed — `main`
// keeps the precise version. Stateful (the world persists across frames), unlike the pure
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
  type Listener,
  MotionQuality,
  MotionType,
  pointConstraint,
  registerAll,
  rigidBody,
  sixDOFConstraint,
  sphere,
  staticCompound,
  updateWorld,
  type World,
} from 'crashcat';
import { vec3 } from 'mathcat';
import { wrapAllowanceM } from '../design/bom';
import { mannequinShapes } from '../design/mannequin';
import { add, cross, dot, length, normalize, rotate, scale, sub } from '../geometry/math3';
import {
  type Attachment,
  type Design,
  type NominalSize,
  pipeSpec,
  type Quaternion,
  type Vec3,
} from '../schema';

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const GRAVITY = 9.81;
const DENSITY = 1400; // PVC ≈ 1400 kg/m³
// Physics engines are tuned for ~metre-scale objects; PVC pipe is ~1 cm radius,
// so the default contact slop lets it sink into the floor. Simulate at SCALE×
// (with gravity scaled to match) and divide positions back, so the geometry is
// engine-friendly and the motion still reads at real speed.
const SCALE = 20;
/** The sim's coordinate scale (positions/sizes/gravity are all ×SCALE). Exposed
 * so the crashcat/three debug renderer can be scaled back to metre space. */
export const PHYSICS_SCALE = SCALE;
const PIVOT_FRICTION_TORQUE = 40; // scaled N·m — light resistance, swings under load
// Elastic bands: a spring force pulls two attachment points together once the
// span exceeds the band's rest length (bands are pre-tensioned, so essentially
// always). Real stiffness (N/m) is scaled into the sim's ×SCALE space:
//   F_scaled = stiffnessNPerM · ELASTIC_K_SCALE · (len_scaled − restLen_scaled)
// Physically exact would be SCALE³ (gravity uses SCALE⁴, extension carries one
// SCALE); that's too stiff/ringy at 60 fps for a hand-drawn band, so a softer,
// well-damped constant is used — TUNED so a default (~150 N/m) band visibly but
// stably pulls two ~0.3 m pipes together without exploding (see the bench check).
const ELASTIC_K_SCALE = SCALE * SCALE * 3;
// Axial damping (scaled): resists the RELATIVE velocity of the two ends along
// the band, killing the spring's ring so it settles instead of oscillating.
const ELASTIC_DAMPING = SCALE * 40;
// Friction resisting a wrapped pivot SLIDING along the pipe it wraps (scaled N).
// A clamped collar grips the pipe, so it mostly stays put but slides under load /
// on a steep tilt. TUNING KNOB — raise to grip harder, lower to slide freer.
const SLIDE_FRICTION_FORCE = 5000;
// A sliding wrap stops this far (metres) short of any obstruction on its receiver
// (the receiver's ends, on-body anchors/tees, other wraps): the mover's own radius
// plus the wrap-hardware allowance (the pipe consumed squishing + wrapping around
// the receiver — see design/bom.ts). Documented-estimate basis, like the BOM's.
const slideClearanceM = (moverOdM: number, receiverSize: NominalSize): number =>
  moverOdM / 2 + wrapAllowanceM(receiverSize);
// Two UNJOINED bodies whose capsules already overlap deeper than this at build
// (metres) are a deliberate user overlap — snapshot the pair as non-colliding so
// pre-existing coexistence doesn't explode. Barely-touching pairs (< this) still
// collide, so pipes resting on each other keep resting.
const PRE_OVERLAP_EPS_M = 0.0005;
// EXPERIMENT (sim-precision-rollback): the three precision mechanisms added in
// 258c139 to stop thin pipes "tunnelling" the floor, isolated by an 8-way sweep
// of a settling welded elbow (see DECISIONS). Result: the VELOCITY CAP does
// nothing (identical with/without); substeps and CCD are REDUNDANT — either one
// alone stops a compound body sinking through the floor. CCD costs ~1 world
// update/frame vs the substep loop's up to 8, so the cheap correct default is
// CCD-ONLY. Flags kept toggleable for manual A/B testing via setPhysicsPrecision.
const MAX_DT = 1 / 30; // clamp a long frame so one step can't over-integrate
const FIXED_DT = 1 / 120; // substep size when substeps are on
const MAX_SUBSTEPS = 8; // cap catch-up steps per frame (no spiral of death)
const MAX_LINEAR_VELOCITY = 30 * SCALE; // scaled m/s velocity cap when on
let useSubsteps = false; // OFF: no 8×/frame loop (the big perf cost)
let useCcd = true; // ON: continuous collision — the one mechanism that matters
let useVcap = false; // OFF: proven to have no effect
let accumulator = 0;
/** Toggle the precision mechanisms (must be set BEFORE startPhysics for CCD /
 * velocity-cap, which are baked into the bodies at world-build). */
export function setPhysicsPrecision(o: {
  substeps?: boolean;
  ccd?: boolean;
  vcap?: boolean;
}): void {
  if (o.substeps !== undefined) useSubsteps = o.substeps;
  if (o.ccd !== undefined) useCcd = o.ccd;
  if (o.vcap !== undefined) useVcap = o.vcap;
}
// ── Perf levers (solver iterations + sleeping). Defaults MATCH crashcat's, so
// nothing changes unless tuned; exposed for A/B measurement via __pvc, like the
// precision flags. Applied at world build → set BEFORE startPhysics. Fewer solver
// iterations = cheaper step, less accurate constraints (joints drift/sag);
// velocityIterations must stay ≥2 for friction. Sleeping skips resting bodies
// (helps settled scenes; articulated models that never rest gain little).
let velocityIterations = 10;
let positionIterations = 2;
let allowSleeping = true;
export function setPhysicsTuning(o: {
  velocityIterations?: number;
  positionIterations?: number;
  allowSleeping?: boolean;
}): void {
  if (o.velocityIterations !== undefined) velocityIterations = Math.max(2, o.velocityIterations);
  if (o.positionIterations !== undefined) positionIterations = Math.max(1, o.positionIterations);
  if (o.allowSleeping !== undefined) allowSleeping = o.allowSleeping;
}

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

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Closest distance between segments [p1,q1] and [p2,q2] (Ericson §5.1.9). */
function segSegDist(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const EPS = 1e-12;
  let s = 0;
  let t = 0;
  if (a > EPS || e > EPS) {
    if (a <= EPS) {
      t = clamp01(f / e);
    } else {
      const c = dot(d1, r);
      if (e <= EPS) {
        s = clamp01(-c / a);
      } else {
        const b = dot(d1, d2);
        const denom = a * e - b * b;
        s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = clamp01(-c / a);
        } else if (t > 1) {
          t = 1;
          s = clamp01((b - c) / a);
        }
      }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  return length(sub(c1, c2));
}

/** Symmetric numeric key for an (unordered) body-id pair. */
const pairKey = (a: number, b: number): number => (a < b ? a * 0x100000 + b : b * 0x100000 + a);

/** A resolved elastic band: each end is a body + the attachment's offset in that
 * body's local frame (scaled space, a mathcat tuple), plus the pre-scaled rest
 * length and spring constant. Built once at world-build; the per-frame force
 * loop only reads these. */
interface SimElastic {
  aBody: number;
  aLocal: [number, number, number];
  bBody: number;
  bLocal: [number, number, number];
  restLenScaled: number;
  kScaled: number;
}

interface Sim {
  world: World;
  bodyOfMember: Map<string, number>;
  /** per node: an incident member body + the node's offset in that body's frame
   * (a mathcat tuple, so the per-frame read path stays allocation-free) */
  nodeSource: Map<string, { memberId: string; local: [number, number, number] }>;
  /** per FORMED member: each control point's offset in its assembly body's local
   * frame (mathcat tuples), so bends ride the rigid body exactly like nodes */
  formedLocals: Map<string, [number, number, number][]>;
  /** resolved elastic bands (spring forces applied each step) */
  elastics: SimElastic[];
  /** global friction/drag multiplier (design.jointDamping ?? 1) — scales the
   * elastic axial damping in the per-frame force loop (joint friction is baked
   * into the constraints at build) */
  damping: number;
  /** per-frame contact listener: vetoes contacts for the excluded body pairs
   * (constraint-connected pairs + pairs already interpenetrating at build) */
  listener: Listener;
  topoHash: string;
}

let sim: Sim | null = null;

/** Rebuild the sim when the topology or rest geometry changes. */
export function physicsTopoHash(design: Design): string {
  return JSON.stringify({
    m: design.members,
    j: design.joints,
    n: design.nodes,
    e: design.elastics,
    man: design.mannequin ?? false,
    damp: design.jointDamping ?? 1,
  });
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
  // perf levers (see setPhysicsTuning) — default to crashcat's own defaults
  settings.solver.velocityIterations = velocityIterations;
  settings.solver.positionIterations = positionIterations;
  settings.sleeping.allowSleeping = allowSleeping;
  const bpMoving = addBroadphaseLayer(settings);
  const bpStatic = addBroadphaseLayer(settings);
  const olMoving = addObjectLayer(settings, bpMoving);
  const olStatic = addObjectLayer(settings, bpStatic);
  enableCollision(settings, olMoving, olStatic);
  // pipes COLLIDE with each other: bodies of different assemblies stack and rest
  // on one another. Members of one rigid assembly are a single compound body
  // (their capsules overlap at unions by design, and a compound never
  // self-collides); pairs that DO interpenetrate by design — the two bodies of a
  // wrapped/free pivot at their joint node, and unjoined bodies the user drew
  // overlapping — are vetoed per-pair via the Listener's onBodyPairValidate
  // (see excludedPairs below), so only real, newly-formed contacts resolve.
  enableCollision(settings, olMoving, olMoving);
  const world = createWorld(settings);

  // global joint/elastic friction-drag multiplier (higher = more settling).
  // Baked into the joint constraints below; also scales the elastic axial damping
  // in the per-frame force loop (stored on the Sim). Identity (1) = no change.
  const damping = design.jointDamping ?? 1;

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

  // static human MANNEQUIN (schema v9): one STATIC compound of the same simple
  // primitives the render layer draws (`mannequinShapes()`), on the olStatic
  // layer so the moving pipes collide with it (olMoving↔olStatic is already
  // enabled, as with the ground) and rest/hang on it instead of the floor.
  if (design.mannequin) {
    const children = mannequinShapes().map((sh) => {
      if (sh.kind === 'sphere')
        return {
          position: s3(sh.center),
          quaternion: [0, 0, 0, 1] as [number, number, number, number],
          shape: sphere.create({ radius: sh.r * SCALE }),
        };
      if (sh.kind === 'box')
        return {
          position: s3(sh.center),
          quaternion: [0, 0, 0, 1] as [number, number, number, number],
          shape: box.create({
            halfExtents: [sh.half.x * SCALE, sh.half.y * SCALE, sh.half.z * SCALE],
          }),
        };
      // capsule: local frame is along +Y, so orient UP → (b−a) and place at the mid
      const along = sub(sh.b, sh.a);
      const len = length(along);
      const dir = len < 1e-6 ? UP : normalize(along);
      const q = quatFromTo(UP, dir);
      const r = sh.r * SCALE;
      return {
        position: s3(scale(add(sh.a, sh.b), 0.5)),
        quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number],
        shape: capsule.create({
          halfHeightOfCylinder: Math.max((len / 2) * SCALE - r, 0.01),
          radius: r,
        }),
      };
    });
    rigidBody.create(world, {
      motionType: MotionType.STATIC,
      shape: staticCompound.create({ children }),
      objectLayer: olStatic,
      position: [0, 0, 0],
      friction: 0.9,
    });
  }

  const bodyOfMember = new Map<string, number>();
  const nodeSource = new Map<string, { memberId: string; local: [number, number, number] }>();
  const formedLocals = new Map<string, [number, number, number][]>();
  // Body pairs whose contacts are vetoed (see the layer comment above): filled
  // with each pivot constraint's body pair, then with every unjoined pair whose
  // rest-pose capsules already interpenetrate (snapshot below).
  const excludedPairs = new Set<number>();
  // Each moving body's collision capsules at rest (metres) + its loose AABB, for
  // the pre-existing-overlap snapshot. Formed members use their CHORD, exactly
  // like the physics shape they get.
  const bodyCapsules: {
    bodyId: number;
    caps: { a: Vec3; b: Vec3; r: number }[];
    min: Vec3;
    max: Vec3;
  }[] = [];
  // per-body rest transform (scaled position + quaternion) — so an elastic
  // attached at a point ALONG a member can be resolved to that body's local frame
  const bodyRest = new Map<number, { pos: Vec3; quat: Quaternion }>();
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

    // a bent (formed) pipe is a rigid body just like a straight one: it keeps its
    // shape (one compound body) but is DYNAMIC, so gravity / collisions apply and
    // it falls & moves with the rest of its assembly.
    const common = {
      motionType: MotionType.DYNAMIC,
      // EXPERIMENT: CCD + velocity cap are toggleable (see setPhysicsPrecision)
      motionQuality: useCcd ? MotionQuality.LINEAR_CAST : MotionQuality.DISCRETE,
      ...(useVcap ? { maxLinearVelocity: MAX_LINEAR_VELOCITY } : {}),
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

    // rest-pose capsules (metres) for the pre-existing-overlap snapshot
    const caps = segs.map((s) => ({
      a: sub(s.mid, scale(s.dir, s.len / 2)),
      b: add(s.mid, scale(s.dir, s.len / 2)),
      r: pipeSpec(s.m.size).odM / 2,
    }));
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const c of caps) {
      for (const p of [c.a, c.b]) {
        min.x = Math.min(min.x, p.x - c.r);
        min.y = Math.min(min.y, p.y - c.r);
        min.z = Math.min(min.z, p.z - c.r);
        max.x = Math.max(max.x, p.x + c.r);
        max.y = Math.max(max.y, p.y + c.r);
        max.z = Math.max(max.z, p.z + c.r);
      }
    }
    bodyCapsules.push({ bodyId: body.id, caps, min, max });

    // each node's offset in the body's local frame, for reading positions back
    const bodyQuatV: Quaternion = {
      x: bodyQuat[0],
      y: bodyQuat[1],
      z: bodyQuat[2],
      w: bodyQuat[3],
    };
    const qc = conj(bodyQuatV);
    const bodyPosV: Vec3 = { x: bodyPos[0], y: bodyPos[1], z: bodyPos[2] };
    bodyRest.set(body.id, { pos: bodyPosV, quat: bodyQuatV });
    for (const s of segs) {
      for (const nid of [s.m.nodeA, s.m.nodeB]) {
        if (nodeSource.has(nid)) continue;
        const np = nodePos.get(nid);
        if (!np) continue;
        const worldOff = sub(scale(np, SCALE), bodyPosV);
        const l = rotate(qc, worldOff);
        nodeSource.set(nid, { memberId: s.id, local: [l.x, l.y, l.z] });
      }
      // a formed member's bend control points are absolute world coords in the
      // doc — fold each into the body's local frame (same transform as nodes)
      // so the bends ride the rigid body during the sim
      if (s.m.kind === 'formed') {
        formedLocals.set(
          s.id,
          s.m.controlPoints.map((cp) => {
            const l = rotate(qc, sub(scale(cp, SCALE), bodyPosV));
            return [l.x, l.y, l.z] as [number, number, number];
          }),
        );
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
    // the two bodies of a pivot interpenetrate at the joint node by design —
    // never generate contacts between them (the constraint holds them instead)
    excludedPairs.add(pairKey(ba, bb));
    if (j.mode === 'free') {
      pointConstraint.create(world, { bodyIdA: ba, bodyIdB: bb, pointA: s3(pos), pointB: s3(pos) });
      continue;
    }
    const axis = receiverDir(design, j);
    let normalA = cross(axis, UP);
    if (length(normalA) < 1e-6) normalA = cross(axis, { x: 1, y: 0, z: 0 });
    normalA = normalize(normalA);
    // slide bounds: the free segment of the receiver this wrap starts in
    // (scaled, relative to the node = slide 0). Obstructions are the receiver's
    // own ends plus every OTHER joint on this receiver (on-body anchors/tees,
    // other wraps, free hubs) — the wrap slides freely between them and
    // hard-stops slideClearanceM short of each (real hardware has width).
    let sMin = 0;
    let sMax = 0;
    const recv = memberById.get(j.receiver);
    const ra = recv ? nodePos.get(recv.nodeA) : undefined;
    const rb = recv ? nodePos.get(recv.nodeB) : undefined;
    if (ra && rb) {
      const da = dot(sub(ra, pos), axis) * SCALE;
      const db = dot(sub(rb, pos), axis) * SCALE;
      sMin = Math.min(da, db);
      sMax = Math.max(da, db);
    }
    for (const j2 of design.joints) {
      if (j2.id === j.id || j2.receiver !== j.receiver) continue;
      const p2 = nodePos.get(j2.nodeId);
      if (!p2) continue;
      const so = dot(sub(p2, pos), axis) * SCALE;
      if (Math.abs(so) < 1e-9) continue; // co-located with this joint (shared hub) — not a wall
      if (so < 0) sMin = Math.max(sMin, so);
      else sMax = Math.min(sMax, so);
    }
    const mover = memberById.get(j.mover);
    const clearS = recv && mover ? slideClearanceM(pipeSpec(mover.size).odM, recv.size) * SCALE : 0;
    sMin = Math.min(sMin + clearS, 0);
    sMax = Math.max(sMax - clearS, 0);
    // CYLINDRICAL joint (6DOF): free TRANSLATION (idx 0) + ROTATION (idx 3) along
    // the receiver axis, each with friction; the other 4 DOF fixed. So the wrap
    // SPINS about AND SLIDES along the pipe it wraps, bounded to its free segment.
    // A fully-crowded segment (bounds collapse) fixes the translation DOF instead.
    // (limit convention: free = [-∞,+∞], fixed = [+∞,-∞], limited = finite min≤0≤max)
    const slideFixed = sMax - sMin < 1e-9;
    sixDOFConstraint.create(world, {
      bodyIdA: ba,
      bodyIdB: bb,
      position1: s3(pos),
      position2: s3(pos),
      axisX1: v3(axis),
      axisY1: v3(normalA),
      axisX2: v3(axis),
      axisY2: v3(normalA),
      limitMin: [slideFixed ? Infinity : sMin, Infinity, Infinity, -Infinity, Infinity, Infinity],
      limitMax: [
        slideFixed ? -Infinity : sMax,
        -Infinity,
        -Infinity,
        Infinity,
        -Infinity,
        -Infinity,
      ],
      maxFriction: [SLIDE_FRICTION_FORCE * damping, 0, 0, PIVOT_FRICTION_TORQUE * damping, 0, 0],
    });
  }

  // ── pre-existing-overlap snapshot: any UNJOINED body pair whose rest-pose
  // capsules already interpenetrate (deeper than PRE_OVERLAP_EPS_M) is a
  // deliberate user overlap — veto its contacts so the coexistence doesn't
  // explode on the first step. Pairs that only touch later still collide.
  for (let i = 0; i < bodyCapsules.length; i++) {
    const A = bodyCapsules[i]!;
    for (let k = i + 1; k < bodyCapsules.length; k++) {
      const B = bodyCapsules[k]!;
      const key = pairKey(A.bodyId, B.bodyId);
      if (excludedPairs.has(key)) continue;
      if (
        A.min.x > B.max.x ||
        B.min.x > A.max.x ||
        A.min.y > B.max.y ||
        B.min.y > A.max.y ||
        A.min.z > B.max.z ||
        B.min.z > A.max.z
      )
        continue;
      outer: for (const ca of A.caps) {
        for (const cb of B.caps) {
          if (segSegDist(ca.a, ca.b, cb.a, cb.b) < ca.r + cb.r - PRE_OVERLAP_EPS_M) {
            excludedPairs.add(key);
            break outer;
          }
        }
      }
    }
  }

  // ── elastic bands: resolve each attachment to a body + local offset (scaled),
  // exactly like nodeSource. A node end reuses its nodeSource offset; a point
  // ALONG a member is lerped in world space then folded into that member's
  // assembly body local frame. Skip a band whose ends don't both resolve or that
  // land on the SAME body (no relative force to give).
  const resolveAttachment = (
    att: Attachment,
  ): { bodyId: number; local: [number, number, number] } | null => {
    if ('nodeId' in att) {
      const src = nodeSource.get(att.nodeId);
      if (!src) return null;
      const bodyId = bodyOfMember.get(src.memberId);
      return bodyId === undefined ? null : { bodyId, local: src.local };
    }
    const m = memberById.get(att.memberId);
    if (!m) return null;
    const a = nodePos.get(m.nodeA);
    const b = nodePos.get(m.nodeB);
    if (!a || !b) return null;
    const bodyId = bodyOfMember.get(att.memberId);
    if (bodyId === undefined) return null;
    const rest = bodyRest.get(bodyId);
    if (!rest) return null;
    const t = Math.max(0, Math.min(1, att.t));
    const world = add(a, scale(sub(b, a), t)); // metres
    const l = rotate(conj(rest.quat), sub(scale(world, SCALE), rest.pos));
    return { bodyId, local: [l.x, l.y, l.z] };
  };

  const elastics: SimElastic[] = [];
  for (const e of design.elastics) {
    const ra = resolveAttachment(e.a);
    const rb = resolveAttachment(e.b);
    if (!ra || !rb || ra.bodyId === rb.bodyId) continue;
    elastics.push({
      aBody: ra.bodyId,
      aLocal: ra.local,
      bBody: rb.bodyId,
      bLocal: rb.local,
      restLenScaled: e.restLengthM * SCALE,
      kScaled: e.stiffnessNPerM * ELASTIC_K_SCALE,
    });
  }

  return {
    world,
    bodyOfMember,
    nodeSource,
    formedLocals,
    elastics,
    damping,
    // broadphase-level per-pair veto (cheapest filtering point crashcat offers);
    // called with the two bodies of every potentially colliding pair each frame
    listener: {
      onBodyPairValidate: (a, b) => !excludedPairs.has(pairKey(a.id, b.id)),
    },
    topoHash: physicsTopoHash(design),
  };
}

export function startPhysics(design: Design): void {
  sim = build(design);
  accumulator = 0;
}
export function stopPhysics(): void {
  sim = null;
}
export function physicsActive(): boolean {
  return sim !== null;
}
/** The live crashcat world (or null) — for the crashcat/three debug renderer. */
export function physicsWorld(): World | null {
  return sim?.world ?? null;
}
export function activeTopoHash(): string {
  return sim?.topoHash ?? '';
}

// Reused scratch for the per-frame elastic force loop (allocation-free hot path).
const _ea = vec3.create();
const _eb = vec3.create();
const _eva = vec3.create();
const _evb = vec3.create();

/** Apply each elastic band's spring + axial-damping force to its two bodies.
 * Runs BEFORE the world integrates, so the forces are consumed by this step.
 * World points are `body.position + quat⊗local` in SCALED space (like
 * physicsNodePositions); a band pulls its ends together once stretched past its
 * rest length (bands are pre-tensioned → essentially always). A force on a
 * STATIC or missing body is skipped. */
function applyElasticForces(): void {
  const s = sim;
  if (!s?.elastics.length) return;
  for (const e of s.elastics) {
    const aBody = rigidBody.get(s.world, e.aBody);
    const bBody = rigidBody.get(s.world, e.bBody);
    if (!aBody || !bBody) continue;
    // world attachment points (scaled)
    vec3.transformQuat(_ea, e.aLocal, aBody.quaternion);
    vec3.add(_ea, _ea, aBody.position);
    vec3.transformQuat(_eb, e.bLocal, bBody.quaternion);
    vec3.add(_eb, _eb, bBody.position);
    const dx = _eb[0] - _ea[0];
    const dy = _eb[1] - _ea[1];
    const dz = _eb[2] - _ea[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;
    const stretch = len - e.restLenScaled;
    if (stretch <= 0) continue; // slack → no push (a band never pushes apart)
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    // spring magnitude + axial damping (relative velocity of the two ends along
    // the band axis) — the damping keeps the stiff spring from ringing/exploding
    rigidBody.getVelocityAtPoint(_eva, aBody, _ea);
    rigidBody.getVelocityAtPoint(_evb, bBody, _eb);
    const vRel = (_evb[0] - _eva[0]) * ux + (_evb[1] - _eva[1]) * uy + (_evb[2] - _eva[2]) * uz;
    const f = e.kScaled * stretch + ELASTIC_DAMPING * s.damping * vRel;
    const staticA = aBody.motionType === MotionType.STATIC;
    const staticB = bBody.motionType === MotionType.STATIC;
    // pull aBody toward bBody (+u), bBody toward aBody (−u)
    if (!staticA) rigidBody.addForceAtPosition(s.world, aBody, [f * ux, f * uy, f * uz], _ea, true);
    if (!staticB)
      rigidBody.addForceAtPosition(s.world, bBody, [-f * ux, -f * uy, -f * uz], _eb, true);
  }
}

/** EXPERIMENT: one coarse step per frame (clamped to MAX_DT), OR fixed 1/120 s
 * substeps (≤8/frame) when substeps are toggled on. */
export function stepPhysics(dt: number): void {
  if (!sim) return;
  applyElasticForces();
  if (!useSubsteps) {
    updateWorld(sim.world, sim.listener, Math.min(dt, MAX_DT));
    return;
  }
  accumulator = Math.min(accumulator + dt, MAX_SUBSTEPS * FIXED_DT);
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    updateWorld(sim.world, sim.listener, FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
}

/** Current world node positions from the simulated bodies. Hot path (runs every
 * sim frame): crashcat returns body.position/quaternion as mathcat tuples, so we
 * compute `body.position + body.quaternion ⊗ local` with reused mathcat scratch —
 * no per-node object wrapping/intermediate allocation, only the emitted metre-
 * space Vec3. */
const _scratch = vec3.create();
export function physicsNodePositions(): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  if (!sim) return out;
  for (const [nodeId, src] of sim.nodeSource) {
    const id = sim.bodyOfMember.get(src.memberId);
    if (id === undefined) continue;
    const body = rigidBody.get(sim.world, id);
    if (!body) continue;
    // scaled space (÷SCALE back to metres)
    vec3.transformQuat(_scratch, src.local, body.quaternion);
    vec3.add(_scratch, _scratch, body.position);
    out[nodeId] = { x: _scratch[0] / SCALE, y: _scratch[1] / SCALE, z: _scratch[2] / SCALE };
  }
  return out;
}

/** Current world-space bend control points of each formed member (memberId →
 * Vec3[], metres), computed on read exactly like `physicsNodePositions` — the
 * doc's control points transformed by their assembly body's live pose. Empty
 * when no sim is active. */
export function physicsFormedControlPoints(): Record<string, Vec3[]> {
  const out: Record<string, Vec3[]> = {};
  if (!sim) return out;
  for (const [memberId, locals] of sim.formedLocals) {
    const id = sim.bodyOfMember.get(memberId);
    if (id === undefined) continue;
    const body = rigidBody.get(sim.world, id);
    if (!body) continue;
    out[memberId] = locals.map((local) => {
      vec3.transformQuat(_scratch, local, body.quaternion);
      vec3.add(_scratch, _scratch, body.position);
      return { x: _scratch[0] / SCALE, y: _scratch[1] / SCALE, z: _scratch[2] / SCALE };
    });
  }
  return out;
}
