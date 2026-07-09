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
