// The static human MANNEQUIN — a rigid, human-shaped collision body the raptor
// (and any design) rests / hangs on instead of falling to the floor. Pure data
// (no three/UI/physics types): both the physics build and the render layer read
// the SAME `mannequinShapes()` primitives, so the collision body and the drawn
// mannequin always agree.
//
// SHARED COORDINATE CONTRACT (metres, y-up, feet at y=0, standing at the ORIGIN
// facing −Z, so a raptor's head/neck extends forward at −Z and its tail back at
// +Z; left = −X, right = +X). The named anchor constants below ARE the contract —
// raptor templates import them so their mount points sit on the mannequin.

import type { Vec3 } from '../schema';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Human proportion + mount-point anchors (the SHARED CONTRACT). Raptor
 * generators import these so their frame lands on the mannequin. All metres. */
export const MANNEQUIN_ANCHORS = {
  /** ground plane — feet rest here */
  footY: 0,
  kneeY: 0.48,
  /** hips / waist height (the seesaw fulcrum plane) */
  hipY: 1.0,
  /** shoulder height (harness bows rest here) */
  shoulderY: 1.45,
  chinY: 1.52,
  /** head sphere centre + radius (top ≈ 1.72) */
  headCenterY: 1.62,
  headR: 0.1,
  /** shoulder saddle half-width: saddles at (±0.23, 1.45, 0) */
  shoulderHalfX: 0.23,
  /** hip pivot half-width: the seesaw fulcrum at (±0.20, 1.00, 0) */
  hipPivotX: 0.2,
  /** body fore-aft half-depth */
  bodyHalfZ: 0.1,
  /** the two shoulder saddles where harness bows rest */
  shoulderSaddleL: v(-0.23, 1.45, 0),
  shoulderSaddleR: v(0.23, 1.45, 0),
  /** the shared hip-pivot fulcrum points (X axis through these) */
  hipPivotL: v(-0.2, 1.0, 0),
  hipPivotR: v(0.2, 1.0, 0),
  /** neck root (front waist rail) reaching forward+up to the head */
  neckRoot: v(0, 1.0, -0.45),
  headNear: v(0, 1.15, -1.3),
  /** tail root (back waist rail) tapering to a tip */
  tailRoot: v(0, 1.0, 0.45),
  tailTip: v(0, 0.9, 1.9),
} as const;

/** A simple collision/render primitive at CONTRACT coordinates (metres). A
 * discriminated union both the physics build and the render layer consume. */
export type MannequinShape =
  | { kind: 'sphere'; center: Vec3; r: number }
  | { kind: 'capsule'; a: Vec3; b: Vec3; r: number }
  | { kind: 'box'; center: Vec3; half: Vec3 };

/** The mannequin as simple primitives at the CONTRACT coordinates: a sphere
 * head, a box torso, a shoulder bar, two arm + two leg capsules, two foot
 * boxes — a ~1.75 m standing human facing −Z. Pure — called by both physics and
 * render, so the body you collide with is exactly the body you see. */
export function mannequinShapes(): MannequinShape[] {
  const A = MANNEQUIN_ANCHORS;
  const shoulderL = v(-A.shoulderHalfX, A.shoulderY, 0);
  const shoulderR = v(A.shoulderHalfX, A.shoulderY, 0);
  const handL = v(-A.shoulderHalfX, A.hipY, 0.05);
  const handR = v(A.shoulderHalfX, A.hipY, 0.05);
  const legHipL = v(-0.1, A.hipY, 0);
  const legHipR = v(0.1, A.hipY, 0);
  const footL = v(-0.1, 0.05, 0.1);
  const footR = v(0.1, 0.05, 0.1);
  return [
    // head
    { kind: 'sphere', center: v(0, A.headCenterY, 0), r: A.headR },
    // torso: shoulders (1.45) → hips (1.00), ~0.34 wide, ~0.20 deep
    {
      kind: 'box',
      center: v(0, (A.shoulderY + A.hipY) / 2, 0),
      half: v(0.17, (A.shoulderY - A.hipY) / 2, A.bodyHalfZ),
    },
    // shoulder bar across the saddles
    { kind: 'capsule', a: shoulderL, b: shoulderR, r: 0.05 },
    // arms
    { kind: 'capsule', a: shoulderL, b: handL, r: 0.05 },
    { kind: 'capsule', a: shoulderR, b: handR, r: 0.05 },
    // legs
    { kind: 'capsule', a: legHipL, b: footL, r: 0.06 },
    { kind: 'capsule', a: legHipR, b: footR, r: 0.06 },
    // feet — boxes extending forward (−Z)
    { kind: 'box', center: v(-0.1, 0.03, -0.02), half: v(0.055, 0.03, 0.13) },
    { kind: 'box', center: v(0.1, 0.03, -0.02), half: v(0.055, 0.03, 0.13) },
  ];
}
