// Shared builder for the Project Raptor loadable templates (Task 3).
//
// Five CUMULATIVE templates model Esmée Kramer's "Project Raptor" walk-around
// costume as a PVC frame worn on a static human MANNEQUIN (see docs/RAPTOR-BRIEF.md
// + the SHARED COORDINATE CONTRACT in src/design/mannequin.ts). Each phase adds to
// the previous: torso → +tail → +legs → +neck → +head. Every mount point is
// authored on the mannequin anchors so the frame rests on its shoulders/waist.
//
// Coordinates: metres, y-up, feet y=0. Mannequin faces −Z, so the raptor head/neck
// reaches forward at −Z and the tail back at +Z; left=−X, right=+X.
//
// Physics note (why balance works): the frame HANGS from the two shoulder bows
// draped over the mannequin's shoulders (a stable yoke — CoM below two supports).
// Cantilevers (tail behind, neck+head in front) are welded at their root so their
// tipping moment about the hip line is transmitted to the frame; the tail is sized
// to counter the neck+head moment so the assembly hangs ~level. Outboard flex
// joints (free/wrapped) + elastic "suspension" bands hold the drooping ends up.

// ── Mannequin anchors (mirrors MANNEQUIN_ANCHORS — the shared contract). Kept
// here as plain numbers so this Node script stays dependency-free.
export const A = {
  footY: 0,
  hipY: 1.0,
  shoulderY: 1.45,
  shoulderHalfX: 0.23,
  hipPivotX: 0.2,
  // waist rectangle extents (the load frame footprint)
  frameHalfX: 0.25, // x ∈ [−0.25, +0.25]
  frameFrontZ: -0.45, // front rail (toward the head)
  frameBackZ: 0.45, // back rail (toward the tail)
  // cantilever targets
  neckRoot: [0, 1.0, -0.45],
  headNear: [0, 1.15, -1.3],
  tailRoot: [0, 1.0, 0.45],
  tailTip: [0, 0.9, 1.9],
};

const HALF = '1/2"';
const TQ = '3/4"';
export { HALF, TQ };

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** Accumulating design builder. Nodes are de-duplicated by rounded coordinate so
 * cumulative phases reuse shared mount nodes; ids are generic (n#, m#, jt#, e#). */
export class Raptor {
  constructor() {
    this.nodes = [];
    this.members = [];
    this.joints = [];
    this.elastics = [];
    this._byKey = new Map();
  }
  /** get-or-create a node id at (x,y,z) */
  n(x, y, z) {
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    const hit = this._byKey.get(key);
    if (hit) return hit;
    const id = `n${this.nodes.length}`;
    this.nodes.push({ id, position: { x: r6(x), y: r6(y), z: r6(z) } });
    this._byKey.set(key, id);
    return id;
  }
  na(p) {
    return this.n(p[0], p[1], p[2]);
  }
  straight(a, b, size) {
    const id = `m${this.members.length}`;
    this.members.push({ id, kind: 'straight', nodeA: a, nodeB: b, size });
    return id;
  }
  formed(a, b, cps, size, fillets) {
    const id = `m${this.members.length}`;
    const m = {
      id,
      kind: 'formed',
      nodeA: a,
      nodeB: b,
      controlPoints: cps.map((p) => ({ x: r6(p[0]), y: r6(p[1]), z: r6(p[2]) })),
      size,
    };
    if (fillets) m.filletRadiiM = fillets;
    this.members.push(m);
    return id;
  }
  joint(nodeId, receiver, mover, mode, extra = {}) {
    const id = `jt${this.joints.length}`;
    this.joints.push({ id, nodeId, receiver, mover, onBody: false, mode, ...extra });
    return id;
  }
  elastic(a, b, restLengthM, stiffnessNPerM) {
    const id = `e${this.elastics.length}`;
    this.elastics.push({ id, a, b, restLengthM: r6(restLengthM), stiffnessNPerM });
    return id;
  }
  toDesign(id, name, jointDamping) {
    return {
      schemaVersion: 9,
      id,
      name,
      unitsPreference: 'metric',
      enabledSizes: [HALF, TQ],
      lengthsLocked: false,
      nodes: this.nodes,
      members: this.members,
      joints: this.joints,
      measurements: [],
      groups: [],
      elastics: this.elastics,
      mannequin: true,
      jointDamping,
    };
  }
}

// ── distance between two [x,y,z] points
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export { dist };

/**
 * PHASE 1 — the hip/shoulder harness frame (the load frame everything hangs from).
 *
 * Support strategy: a small rigid SHOULDER PLATFORM at y≈1.46 rests flat on the
 * mannequin's shoulder bar + torso-top (two line contacts, front + back of the
 * neck, clear of the head sphere) — a stable yoke whose CoM hangs below it. The
 * platform ties down to a waist RECTANGLE at y=1.0 (surrounding the wearer) via
 * four heat-`formed` harness bows that arch outboard over the shoulders. Short
 * front/back masts give high anchor nodes for the suspension elastics of later
 * phases. All connections rigid (default `anchor`). Returns the mount-node ids
 * later phases attach to.
 */
export function buildTorso(R) {
  const y = A.hipY; // 1.0
  const hx = A.frameHalfX; // 0.25
  const fz = A.frameFrontZ; // −0.45
  const bz = A.frameBackZ; // 0.45

  // ── waist rectangle corners
  const FL = R.n(-hx, y, fz);
  const FR = R.n(hx, y, fz);
  const BR = R.n(hx, y, bz);
  const BL = R.n(-hx, y, bz);
  // rail split points: neck/tail roots (front/back mid), bow feet + hip nodes
  const NR = R.na(A.neckRoot); // (0,1,−0.45) neck root on the front rail
  const TR = R.na(A.tailRoot); // (0,1,0.45) tail root on the back rail
  const LBF = R.n(-hx, y, -0.2); // left bow front foot
  const LH = R.n(-hx, y, 0); // left hip node (leg mount)
  const LBB = R.n(-hx, y, 0.2); // left bow back foot
  const RBF = R.n(hx, y, -0.2);
  const RH = R.n(hx, y, 0); // right hip node
  const RBB = R.n(hx, y, 0.2);

  // front + back rails (split at neck/tail roots)
  R.straight(FL, NR, TQ);
  R.straight(NR, FR, TQ);
  R.straight(BL, TR, TQ);
  R.straight(TR, BR, TQ);
  // left + right rails (split at bow feet + hip node)
  R.straight(FL, LBF, TQ);
  R.straight(LBF, LH, TQ);
  R.straight(LH, LBB, TQ);
  R.straight(LBB, BL, TQ);
  R.straight(FR, RBF, TQ);
  R.straight(RBF, RH, TQ);
  R.straight(RH, RBB, TQ);
  R.straight(RBB, BR, TQ);

  // ── shoulder platform: a 0.40 (x) × 0.16 (z) rectangle at y=1.46 that seats on
  // the shoulder bar + flat torso-top. Front/back rails at z=±0.08 lie on the
  // torso top; side rails at x=±0.20 cross the shoulder bar — two broad line
  // contacts either side of the neck, so the yoke can't roll or slide off.
  const py = 1.46;
  const pxx = 0.2;
  const pz = 0.08;
  const SFL = R.n(-pxx, py, -pz);
  const SFR = R.n(pxx, py, -pz);
  const SBR = R.n(pxx, py, pz);
  const SBL = R.n(-pxx, py, pz);
  R.straight(SFL, SFR, TQ);
  R.straight(SFR, SBR, TQ);
  R.straight(SBR, SBL, TQ);
  R.straight(SBL, SFL, TQ);

  // ── four heat-`formed` harness bows tie each platform corner down to a waist
  // bow-foot, bulging OUTBOARD over the shoulder (apex x≈±0.30, outside the
  // shoulder). These carry the load from the platform onto the frame.
  R.formed(SFL, LBF, [[-0.3, 1.24, -0.15]], TQ, [0.1]);
  R.formed(SBL, LBB, [[-0.3, 1.24, 0.15]], TQ, [0.1]);
  R.formed(SFR, RBF, [[0.3, 1.24, -0.15]], TQ, [0.1]);
  R.formed(SBR, RBB, [[0.3, 1.24, 0.15]], TQ, [0.1]);

  // ── front + rear masts: short posts above the neck/tail roots — high anchor
  // nodes for the suspension elastics (and they read as the harness uprights).
  const FMT = R.n(0, 1.42, fz); // front mast top
  const RMT = R.n(0, 1.42, bz); // rear mast top
  R.straight(NR, FMT, TQ);
  R.straight(TR, RMT, TQ);
  // diagonal struts brace each mast down to the near rail corners (2 front, 2 back)
  R.straight(FMT, FL, TQ);
  R.straight(FMT, FR, TQ);
  R.straight(RMT, BL, TQ);
  R.straight(RMT, BR, TQ);

  return { FL, FR, BR, BL, NR, TR, LH, RH, FMT, RMT, SFL, SFR, SBL, SBR };
}

/**
 * PHASE 2 — the tapering, segmented TAIL cantilevered off the back rail (the
 * counterweight for the future neck+head). A ~1.5 m chain rising slightly then
 * dropping to a tip, welded at the root, with three `free` flex joints (the
 * garden-hose inflection points) beyond it. Elastic "suspension" bands from the
 * rear mast hold the drooping chain up near level (the fibreglass-rod return).
 * `mounts` is buildTorso's return.
 */
export function buildTail(R, mounts) {
  const { TR } = mounts;
  // spine nodes: rises slightly at the base then tapers down to the tip
  const T1 = R.n(0, 1.07, 0.88);
  const T2 = R.n(0, 1.06, 1.3); // end of the rigid (welded) base cantilever
  const T3 = R.n(0, 1.0, 1.66); // first flex point
  const T4 = R.n(0, 0.92, 1.98); // tip (second flex point beyond it)

  // RIGID base (welded to the frame): TR–T1–T2 is a stiff cantilever — this is the
  // counterweight moment about the hip line. ¾" (heavier = more counter-torque).
  R.straight(TR, T1, TQ);
  const s1 = R.straight(T1, T2, TQ);
  // outer chain: two ½" segments on two `wrapped` flex joints. The hinge axis is
  // the receiver's own axis (the tail's +z run), so gravity (which torques about
  // x) is RESISTED — the tail holds its extended shape instead of drooping to the
  // floor — while the joints still SWING the tail side-to-side (its main motion)
  // when posed. This is the robust stand-in for the fibreglass-sprung garden hose.
  const s2 = R.straight(T2, T3, HALF);
  const s3 = R.straight(T3, T4, HALF);
  R.joint(T2, s1, s2, 'wrapped', { angleRad: 0 });
  R.joint(T3, s2, s3, 'wrapped', { angleRad: 0 });

  // dorsal post on the rigid base — a high anchor for the lateral-return bands.
  const DP = R.n(0, 1.34, 1.22);
  R.straight(T2, DP, HALF);

  // suspension / centring bands: DP → the two outer nodes, lightly pre-tensioned
  // (rest ≈ 0.9× span) so they hold the outer chain up and re-centre a posed swing
  // without hauling the extended tail inward (the crossed-cable return, approx).
  const susp = (node, k) => {
    const d = dist(posOf(R, DP), posOf(R, node));
    R.elastic({ nodeId: DP }, { nodeId: node }, d * 0.9, k);
  };
  susp(T3, 200);
  susp(T4, 160);

  return { ...mounts, T1, T2, T3, T4, DP };
}

/** world position [x,y,z] of a node id (helper for elastic rest-length sizing) */
export function posOf(R, id) {
  const p = R.nodes[+id.slice(1)].position;
  return [p.x, p.y, p.z];
}

/** first existing member id incident to a node (used to find a rail segment as a
 * joint receiver) */
function incidentMember(R, nodeId) {
  const m = R.members.find((m) => m.nodeA === nodeId || m.nodeB === nodeId);
  return m ? m.id : null;
}

/**
 * PHASE 3 — two decorative digitigrade legs (thigh / shin / foot) hung at the
 * hips beside the wearer, OUTBOARD of the mannequin's own legs (x=±0.30). Not
 * load-bearing. `wrapped` hinges at hip / knee / ankle (about each receiver's
 * axis) hold the drawn reverse-knee pose under gravity while staying poseable;
 * light elastics act as the heel-lift / toe-hold returns. The legs sit near the
 * hip line (z≈0), so their net moment about the seesaw is ~zero.
 */
export function buildLegs(R, mounts) {
  const { LH, RH } = mounts;
  const out = { ...mounts, legs: [] };
  for (const [hip, s] of [
    [LH, -1],
    [RH, 1],
  ]) {
    const railRecv = incidentMember(R, hip); // a waist-rail segment at the hip
    const K = R.n(s * 0.3, 0.55, -0.12); // knee (forward)
    const Ank = R.n(s * 0.3, 0.18, 0.03); // ankle (back — digitigrade)
    const Toe = R.n(s * 0.3, 0.06, -0.18); // paw/toe (forward)
    const thigh = R.straight(hip, K, HALF);
    const shin = R.straight(K, Ank, HALF);
    const foot = R.straight(Ank, Toe, HALF);
    // hip abducts about the waist rail; knee + ankle hinge about their own segment
    R.joint(hip, railRecv, thigh, 'wrapped', { angleRad: 0 });
    R.joint(K, thigh, shin, 'wrapped', { angleRad: 0 });
    R.joint(Ank, shin, foot, 'wrapped', { angleRad: 0 });
    // returns: heel lift (hip→paw) + toe hold (knee→paw), lightly pre-tensioned
    R.elastic({ nodeId: hip }, { nodeId: Toe }, dist(posOf(R, hip), posOf(R, Toe)) * 0.9, 120);
    R.elastic({ nodeId: K }, { nodeId: Toe }, dist(posOf(R, K), posOf(R, Toe)) * 0.9, 90);
    out.legs.push({ hip, K, Ank, Toe });
  }
  return out;
}

/**
 * PHASE 4 — the segmented NECK cantilevered forward (−z) from the front rail, the
 * FRONT counterweight to the tail. A welded root (the conduit-box mount) gives a
 * clean forward moment, with two `wrapped` flex joints beyond it (the neck holds
 * its extended forward shape under gravity, like the tail) and elastic "head-up"
 * bands from the front mast to the head end (the green-elastic return in the
 * sketches). Two loose ½" mini-arms hang off the conduit box on `free` joints.
 * ¾" neck beam. Returns the head-base node the head mounts on.
 */
export function buildNeck(R, mounts) {
  const { NR, FMT } = mounts;
  // gentle rise, then near-horizontal along −z (segments ~parallel to the wrapped
  // hinge axis, so the joints hold the extended forward reach instead of curling)
  const N1 = R.n(0, 1.1, -0.85); // welded root tip (conduit box)
  const N2 = R.n(0, 1.14, -1.15); // first flex
  const HB = R.n(0, 1.15, -1.42); // head base

  R.straight(NR, N1, TQ); // welded to the frame
  const s1 = R.straight(N1, N2, TQ);
  const s2 = R.straight(N2, HB, TQ);
  R.joint(N1, R.members.find((m) => m.nodeA === NR && m.nodeB === N1).id, s1, 'wrapped', {
    angleRad: 0,
  });
  R.joint(N2, s1, s2, 'wrapped', { angleRad: 0 });

  // head-up return: front mast → the two forward neck nodes, lightly pre-tensioned
  const up = (node, k) => {
    R.elastic({ nodeId: FMT }, { nodeId: node }, dist(posOf(R, FMT), posOf(R, node)) * 0.9, k);
  };
  up(N2, 150);
  up(HB, 170);

  // two loose mini-arms off the conduit box (free ball joints — they just dangle)
  for (const s of [-1, 1]) {
    const shoulder = R.n(s * 0.12, 1.06, -0.78); // on the welded neck root region
    R.straight(N1, shoulder, HALF); // stub welding the arm mount to the neck root
    const hand = R.n(s * 0.2, 0.72, -0.72);
    const arm = R.straight(shoulder, hand, HALF);
    const stub = R.members.find((m) => m.nodeA === N1 && m.nodeB === shoulder).id;
    R.joint(shoulder, stub, arm, 'free');
  }

  return { ...mounts, N1, N2, HB };
}

/**
 * PHASE 5 — the HEAD: a compact skull welded to the neck head-base plus a lower
 * jaw on a `wrapped` hinge (a short x-axis cross-pin as the receiver, so the jaw
 * swings open in the z–y plane) with a sprung-closed elastic. The head is the
 * heaviest front element, so the full raptor's tail must counter it — see the
 * balance tuning in the generator/DECISIONS. ½" head. Returns nothing new needed.
 */
export function buildHead(R, mounts) {
  const { HB } = mounts;
  const ST = R.n(0, 1.25, -1.56); // skull crown
  const Nose = R.n(0, 1.12, -1.82); // snout tip
  const JP = R.n(0, 1.08, -1.52); // jaw pivot (cross-pin midpoint)
  const JPL = R.n(-0.05, 1.08, -1.52);
  const JPR = R.n(0.05, 1.08, -1.52);
  const JT = R.n(0, 1.03, -1.78); // lower-jaw tip

  // skull (all welded to the neck via HB)
  R.straight(HB, ST, HALF);
  R.straight(ST, Nose, HALF);
  R.straight(HB, JP, HALF); // skull down to the jaw pivot
  R.straight(Nose, JP, HALF); // snout underside back to the pivot (closes the skull)
  // jaw cross-pin (x-axis), welded to the skull at JP
  R.straight(JPL, JP, HALF);
  const pin = R.straight(JP, JPR, HALF);
  // lower jaw: wrapped hinge about the cross-pin → opens/closes in the z–y plane
  const jaw = R.straight(JP, JT, HALF);
  R.joint(JP, pin, jaw, 'wrapped', { angleRad: 0 });
  // sprung-closed return: jaw tip → snout tip (holds the mouth shut at rest)
  R.elastic({ nodeId: JT }, { nodeId: Nose }, dist(posOf(R, JT), posOf(R, Nose)) * 0.8, 140);

  return { ...mounts, ST, Nose, JT };
}
