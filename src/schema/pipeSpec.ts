// Static PVC SCH 40 dimension table (planfile §3). A constant module, NOT a
// schema — fitting dimensions live here, never in the document. All values SI
// (metres); source inch figures are ASTM D1785 (pipe OD/wall) and ASTM D2466
// (socket depth) and are cited inline. Elbow/tee/cross centre-to-face
// take-offs are added in Phase 2 (fitting auto-solve) from Spears SCH 40
// tables; they are optional here until then.
import type { NominalSize } from './common';

/** 1 inch in metres (exact). Inlined so this table stays dependency-free. */
const IN = 0.0254;

export interface PipeSpec {
  nominal: NominalSize;
  /** outside diameter (m) */
  odM: number;
  /** wall thickness (m) */
  wallM: number;
  /** socket insertion depth (m): how far a pipe seats into a fitting hub */
  socketDepthM: number;
  /** elbow centre-to-face take-off (m), added Phase 2 */
  elbow90CentreToFaceM?: number;
  elbow45CentreToFaceM?: number;
  /** tee run / branch centre-to-face take-off (m), added Phase 2 */
  teeRunCentreToFaceM?: number;
  teeBranchCentreToFaceM?: number;
}

/** SCH 40 dimensions per nominal size. OD/wall: ASTM D1785. Socket depths:
 * nominal ASTM D2466 socket entrance depths (0.688 in for 1/2", 0.75 in for
 * 3/4"). */
export const PIPE_SPECS: Record<NominalSize, PipeSpec> = {
  '1/2"': {
    nominal: '1/2"',
    odM: 0.84 * IN, // 0.840 in
    wallM: 0.109 * IN,
    socketDepthM: 0.688 * IN,
  },
  '3/4"': {
    nominal: '3/4"',
    odM: 1.05 * IN, // 1.050 in
    wallM: 0.113 * IN,
    socketDepthM: 0.75 * IN,
  },
};

export function pipeSpec(size: NominalSize): PipeSpec {
  return PIPE_SPECS[size];
}
