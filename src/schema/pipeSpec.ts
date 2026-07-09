// Static PVC SCH 40 dimension table (planfile §3). A constant module, NOT a
// schema — fitting dimensions live here, never in the document. All values SI
// (metres); source inch figures are ASTM D1785/D2466 and the Spears SCH 40
// fitting catalog cited inline.
import type { NominalSize } from './common';

/** 1 inch in metres (exact). Inlined so this table stays dependency-free. */
const IN = 0.0254;

export type FabricationBasis = 'sourced' | 'estimate' | 'model';

export interface FabricationSource {
  basis: FabricationBasis;
  label: string;
  note?: string;
  url?: string;
}

export interface FabricationMeasurement {
  valueM: number;
  source: FabricationSource;
}

export interface FittingTakeoffSpec {
  /** 90° elbow: centerline intersection to socket bottom (`G`) */
  elbow90?: FabricationMeasurement;
  /** 45° elbow: centerline intersection to socket bottom (`J`) */
  elbow45?: FabricationMeasurement;
  /** side-outlet corner elbow: centerline intersection to socket bottom (`G`) */
  elbow3way?: FabricationMeasurement;
  /** tee straight run: centerline intersection to socket bottom (`G`) */
  teeRun?: FabricationMeasurement;
  /** tee branch: centerline intersection to socket bottom (`G1`) */
  teeBranch?: FabricationMeasurement;
  /** cross sockets: centerline intersection to socket bottom (`G`/`G1`) */
  cross?: FabricationMeasurement;
}

export interface PipeSpec {
  nominal: NominalSize;
  /** outside diameter (m) */
  odM: number;
  /** wall thickness (m) */
  wallM: number;
  /** socket insertion depth (m): how far a pipe seats into a fitting hub */
  socketDepthM: number;
  socketDepthSource: FabricationSource;
  /** pipe cut take-offs from fitting centerline intersection to socket bottom */
  fittingTakeoffs?: FittingTakeoffSpec;
  /** optional external face dimensions, not used for pipe cut length */
  elbow90CentreToFaceM?: number;
  elbow45CentreToFaceM?: number;
  teeRunCentreToFaceM?: number;
  teeBranchCentreToFaceM?: number;
}

const SPEARS_SCH40_URL =
  'https://www.spearsmfg.com/super_sourcebook/SSB-1%20Part%202%20Technical%20Information%20Catalog/003%20PVC%20White%20Schedule%2040%20Fittings%2C%20Unions%2C%20Saddles.pdf';

const ASTM_PIPE_SOURCE: FabricationSource = {
  basis: 'sourced',
  label: 'ASTM D1785 / ASTM D2466 dimensions',
};

const SPEARS_SOURCE: Omit<FabricationSource, 'note'> = {
  basis: 'sourced',
  label: 'Spears PVC White Schedule 40 fitting catalog',
  url: SPEARS_SCH40_URL,
};

const sourcedIn = (valueIn: number, note: string): FabricationMeasurement => ({
  valueM: valueIn * IN,
  source: { ...SPEARS_SOURCE, note },
});

/** SCH 40 dimensions per nominal size. OD/wall/socket: ASTM D1785/D2466.
 * Fitting take-offs use Spears molded socket fitting rows:
 * tee 401, elbow 406/417, side-outlet elbow 413, cross 420. */
export const PIPE_SPECS: Record<NominalSize, PipeSpec> = {
  '1/2"': {
    nominal: '1/2"',
    odM: 0.84 * IN, // 0.840 in
    wallM: 0.109 * IN,
    socketDepthM: 0.688 * IN,
    socketDepthSource: ASTM_PIPE_SOURCE,
    fittingTakeoffs: {
      teeRun: sourcedIn(0.5, '401-005 tee G'),
      teeBranch: sourcedIn(0.5, '401-005 tee G1'),
      elbow90: sourcedIn(0.5, '406-005 90° elbow G'),
      elbow45: sourcedIn(11 / 32, '417-005 45° elbow J'),
      elbow3way: sourcedIn(0.5, '413-005 side-outlet elbow G'),
      cross: sourcedIn(17 / 32, '420-005 cross G/G1'),
    },
    elbow90CentreToFaceM: 1.25 * IN,
    elbow45CentreToFaceM: 1.125 * IN,
    teeRunCentreToFaceM: 1.25 * IN,
    teeBranchCentreToFaceM: 1.25 * IN,
  },
  '3/4"': {
    nominal: '3/4"',
    odM: 1.05 * IN, // 1.050 in
    wallM: 0.113 * IN,
    socketDepthM: 0.719 * IN,
    socketDepthSource: ASTM_PIPE_SOURCE,
    fittingTakeoffs: {
      teeRun: sourcedIn(9 / 16, '401-007 tee G'),
      teeBranch: sourcedIn(9 / 16, '401-007 tee G1'),
      elbow90: sourcedIn(9 / 16, '406-007 90° elbow G'),
      elbow45: sourcedIn(7 / 16, '417-007 45° elbow J'),
      elbow3way: sourcedIn(9 / 16, '413-007 side-outlet elbow G'),
      cross: sourcedIn(9 / 16, '420-007 cross G/G1'),
    },
    elbow90CentreToFaceM: 1.5 * IN,
    elbow45CentreToFaceM: 1.375 * IN,
    teeRunCentreToFaceM: 1.5625 * IN,
    teeBranchCentreToFaceM: 1.5625 * IN,
  },
};

export function pipeSpec(size: NominalSize): PipeSpec {
  return PIPE_SPECS[size];
}
