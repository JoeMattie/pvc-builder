// The solver boundary (planfile §5). No three.js / UI / engine types cross
// this interface. Design (unlocked) mode is NOT physics — direct manipulation
// edits node positions and solve() returns them unchanged. Locked (pose) mode
// runs deterministic kinematics (src/solver/kinematics.ts): members are rigid,
// pivots are revolute, and drag rotates pivots via IK — preserving every member
// length exactly.
import type { Design, Quaternion, Vec3 } from '../schema';
import { solvePose } from './kinematics';

export type SolveMode = 'pose';

export interface SolveInputs {
  lengthsLocked: boolean;
  /** pivotId → target angle (from the angle sliders / stored pivot angles) */
  pivotAngles: Record<string, number>;
  /** a node being dragged in locked mode — IK rotates pivots to follow it */
  dragTarget?: { nodeId: string; position: Vec3 };
}

export interface SolveResult {
  nodePositions: Record<string, Vec3>;
  memberTransforms: Record<string, { position: Vec3; quaternion: Quaternion }>;
  /** resolved pivot angles after solving (drag IK writes these back so the
   * sliders track a drag) — an extension of the planfile shape */
  pivotAngles: Record<string, number>;
  diagnostics: {
    mobilityDof: number;
    overConstrained: boolean;
    converged: boolean;
    conflicts: string[];
  };
}

const IDENTITY_Q: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

function identityResult(design: Design): SolveResult {
  const nodePositions: Record<string, Vec3> = {};
  for (const n of design.nodes) nodePositions[n.id] = n.position;
  const memberTransforms: Record<string, { position: Vec3; quaternion: Quaternion }> = {};
  for (const m of design.members) {
    memberTransforms[m.id] = { position: { x: 0, y: 0, z: 0 }, quaternion: IDENTITY_Q };
  }
  const pivotAngles: Record<string, number> = {};
  for (const p of design.pivots) pivotAngles[p.id] = p.angleRad ?? 0;
  return {
    nodePositions,
    memberTransforms,
    pivotAngles,
    diagnostics: { mobilityDof: 0, overConstrained: false, converged: true, conflicts: [] },
  };
}

export function solve(design: Design, inputs: SolveInputs, _mode: SolveMode): SolveResult {
  // unlocked mode is direct manipulation, not physics — positions unchanged
  if (!inputs.lengthsLocked) return identityResult(design);
  const pose = solvePose(design, {
    pivotAngles: inputs.pivotAngles,
    dragTarget: inputs.dragTarget,
  });
  return {
    nodePositions: pose.nodePositions,
    memberTransforms: pose.memberTransforms,
    pivotAngles: pose.pivotAngles,
    diagnostics: {
      mobilityDof: pose.mobilityDof,
      overConstrained: pose.overConstrained,
      converged: pose.converged,
      conflicts: [],
    },
  };
}
