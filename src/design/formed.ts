// Formed (heat-bent) pipe analysis (planfile §3/§8): developed centre-line
// length, bend schedule, and a min-bend-radius check, all from the pure
// geometry in geometry/pipe.ts. No three.js / UI types.
import {
  bendDihedralsRad,
  deflectionAngleRad,
  developedLengthM,
  polylineLengthM,
} from '../geometry/pipe';
import { type Design, type FormedMember, pipeSpec, type Vec3 } from '../schema';
import { nodeById } from './docOps';

/** Heat-forming minimum bend radius ≈ this many pipe ODs. An estimate for PVC
 * hot-bending (kinking below ~3×D); the exact limit depends on wall + method. */
export const MIN_BEND_RADIUS_FACTOR = 3;

/** The full polyline a formed pipe sweeps: nodeA → control points → nodeB. */
export function formedPoints(design: Design, member: FormedMember): Vec3[] | null {
  const a = nodeById(design, member.nodeA)?.position;
  const b = nodeById(design, member.nodeB)?.position;
  if (!a || !b) return null;
  return [a, ...member.controlPoints, b];
}

export interface BendInfo {
  /** control-point index (0-based) */
  index: number;
  /** turn angle at the bend (0 = straight, π = reversal) */
  deflectionRad: number;
  /** bend-plane rotation relative to the previous bend (fabrication twist) */
  dihedralRad: number;
  /** specified fillet/bend radius (0 = sharp / unspecified) */
  filletRadiusM: number;
  /** the bend is tighter than the pipe can be heat-formed */
  belowMin: boolean;
}

export interface FormedAnalysis {
  points: Vec3[];
  /** sharp-polyline (chord) length */
  chordLengthM: number;
  /** filleted centre-line length — the fabrication cut length */
  developedLengthM: number;
  minBendRadiusM: number;
  bends: BendInfo[];
  hasTightBend: boolean;
}

export function analyzeFormed(design: Design, member: FormedMember): FormedAnalysis | null {
  const points = formedPoints(design, member);
  if (!points) return null;
  const fillets = member.filletRadiiM ?? [];
  const minBendRadiusM = pipeSpec(member.size).odM * MIN_BEND_RADIUS_FACTOR;
  const dihedrals = bendDihedralsRad(points);
  const bends: BendInfo[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const filletRadiusM = fillets[i - 1] ?? 0;
    bends.push({
      index: i - 1,
      deflectionRad: deflectionAngleRad(points[i - 1]!, points[i]!, points[i + 1]!),
      dihedralRad: dihedrals[i - 1] ?? 0,
      filletRadiusM,
      belowMin: filletRadiusM > 0 && filletRadiusM < minBendRadiusM,
    });
  }
  return {
    points,
    chordLengthM: polylineLengthM(points),
    developedLengthM: developedLengthM(points, fillets),
    minBendRadiusM,
    bends,
    hasTightBend: bends.some((b) => b.belowMin),
  };
}
