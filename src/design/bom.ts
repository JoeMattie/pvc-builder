// Bill of materials / cut-list (planfile §8). Pure: per-pipe cut length =
// centre-to-centre span minus each end's fitting take-off; fitting counts by
// type + size; and for formed pipes the developed length + bend schedule. The
// take-off math is exact given the fitting take-off constants below (which are
// documented ESTIMATES to be replaced with manufacturer tables). No three/UI
// types. Hand-rolled CSV.
import { bendDihedralsRad } from '../geometry/pipe';
import { type Design, type JointMode, type NominalSize, pipeSpec } from '../schema';
import { formatLengthDisplay } from '../ui/units';
import { memberLengthM } from './docOps';
import { type FittingType, resolveFittings } from './fittings';
import { analyzeFormed, formedPoints } from './formed';

/** An eye-bolt + knotted cord shortens each pipe end at a FREE (ball) pivot — a
 * documented ESTIMATE take-off (≈1"), like the fitting take-offs above. */
export const EYE_BOLT_TAKEOFF_M = 0.0254;

// Fitting centre-to-face ÷ pipe OD — an ESTIMATE of how far the fitting body
// eats into the centre-to-centre run past the socket. Replace with Spears /
// manufacturer SCH 40 take-off tables when available; the cut-list math is
// exact for whatever these are. Couplings/reducers butt at the centre (≈0).
const CENTRE_TO_FACE_FACTOR: Partial<Record<FittingType, number>> = {
  elbow90: 1.2,
  elbow45: 0.95,
  tee: 1.2,
  cross: 1.2,
};

/** How much a fitting shortens a pipe end from the centre-to-centre length. */
export function fittingTakeoffM(type: FittingType, size: NominalSize): number {
  const factor = CENTRE_TO_FACE_FACTOR[type];
  if (!factor) return 0; // coupling / reducer: pipe runs to the joint centre
  const spec = pipeSpec(size);
  return Math.max(0, factor * spec.odM - spec.socketDepthM);
}

export interface CutItem {
  memberId: string;
  size: NominalSize;
  kind: 'straight' | 'formed';
  /** centre-to-centre span (straight) or developed centre-line (formed), m */
  spanM: number;
  /** span minus end fitting take-offs — the length to cut, m */
  cutLengthM: number;
  takeoffAM: number;
  takeoffBM: number;
  /** formed only: bend-plane rotations (fabrication schedule), radians */
  bendsRad?: number[];
}

export interface FittingLine {
  type: FittingType;
  sizes: NominalSize[];
  reducing: boolean;
  count: number;
}

/** Non-fitting joint hardware (not a socket fitting): a wrapped/free pivot or a
 * screwed on-body tee. `wrapped`/`anchor` are heat-wrapped; `free` is a ball
 * joint (2 eye bolts + a ball + cord per joint). */
export interface JointLine {
  mode: JointMode;
  count: number;
}

export interface Bom {
  cuts: CutItem[];
  fittings: FittingLine[];
  /** joint hardware counts by mode (wrapped / free / anchor) */
  joints: JointLine[];
  conflicts: number;
  /** total pipe to buy per size (sum of cut lengths), m */
  totalBySize: Partial<Record<NominalSize, number>>;
}

export function bom(design: Design): Bom {
  const { fittings, conflicts } = resolveFittings(design);
  const fittingByNode = new Map(fittings.map((f) => [f.nodeId, f]));
  // a free (ball) pivot shortens each pipe end that butts into it
  const freeNodes = new Set(design.joints.filter((j) => j.mode === 'free').map((j) => j.nodeId));

  const cuts: CutItem[] = [];
  const totalBySize: Partial<Record<NominalSize, number>> = {};

  const endTakeoff = (fittingNode: string | undefined, size: NominalSize): number => {
    const f = fittingNode ? fittingByNode.get(fittingNode) : undefined;
    if (f) return fittingTakeoffM(f.type, size);
    return fittingNode && freeNodes.has(fittingNode) ? EYE_BOLT_TAKEOFF_M : 0;
  };

  for (const m of design.members) {
    const takeoffAM = endTakeoff(m.nodeA, m.size);
    const takeoffBM = endTakeoff(m.nodeB, m.size);

    let spanM: number;
    let bendsRad: number[] | undefined;
    if (m.kind === 'formed') {
      const analysis = analyzeFormed(design, m);
      spanM = analysis?.developedLengthM ?? 0;
      const pts = formedPoints(design, m);
      bendsRad = pts ? bendDihedralsRad(pts) : [];
    } else {
      spanM = memberLengthM(design, m);
    }
    const cutLengthM = Math.max(0, spanM - takeoffAM - takeoffBM);
    cuts.push({
      memberId: m.id,
      size: m.size,
      kind: m.kind,
      spanM,
      cutLengthM,
      takeoffAM,
      takeoffBM,
      bendsRad,
    });
    totalBySize[m.size] = (totalBySize[m.size] ?? 0) + cutLengthM;
  }

  // fitting counts keyed by type + sizes + reducing
  const lines = new Map<string, FittingLine>();
  for (const f of fittings) {
    const sizes = [...new Set(f.ends.map((e) => e.size))].sort() as NominalSize[];
    const key = `${f.type}|${sizes.join(',')}|${f.reducing}`;
    const line = lines.get(key);
    if (line) line.count++;
    else lines.set(key, { type: f.type, sizes, reducing: f.reducing, count: 1 });
  }

  // joint hardware counts by mode (wrapped / free / anchor)
  const jointCounts = new Map<JointMode, number>();
  for (const j of design.joints) jointCounts.set(j.mode, (jointCounts.get(j.mode) ?? 0) + 1);
  const joints: JointLine[] = [...jointCounts.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => a.mode.localeCompare(b.mode));

  return {
    cuts,
    fittings: [...lines.values()].sort((a, b) => a.type.localeCompare(b.type)),
    joints,
    conflicts: conflicts.length,
    totalBySize,
  };
}

export const JOINT_LABEL: Record<JointMode, string> = {
  wrapped: 'wrapped pivot',
  free: 'free pivot',
  anchor: 'screwed tee',
};
export const JOINT_HARDWARE: Record<JointMode, string> = {
  wrapped: 'heat-wrap',
  free: '2 eye bolts + ball + cord',
  anchor: 'heat-wrap + set screws',
};

function csvCell(s: string | number): string {
  const v = String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Shop-ready CSV: a cut list, then a fitting count, then totals. */
export function bomToCsv(design: Design): string {
  const b = bom(design);
  const disp = design.lengthDisplay;
  const rows: string[] = [];
  const line = (...cells: Array<string | number>) => rows.push(cells.map(csvCell).join(','));

  line('Cut list');
  line('Pipe', 'Size', 'Type', 'Span', 'Take-off A', 'Take-off B', 'Cut length');
  b.cuts.forEach((c, i) => {
    line(
      `P${i + 1}`,
      c.size,
      c.kind,
      formatLengthDisplay(c.spanM, disp),
      formatLengthDisplay(c.takeoffAM, disp),
      formatLengthDisplay(c.takeoffBM, disp),
      formatLengthDisplay(c.cutLengthM, disp),
    );
  });
  line('');
  line('Fittings');
  line('Type', 'Sizes', 'Reducing', 'Count');
  for (const f of b.fittings) line(f.type, f.sizes.join(' × '), f.reducing ? 'yes' : '', f.count);
  if (b.joints.length) {
    line('');
    line('Joints');
    line('Type', 'Hardware', 'Count');
    for (const j of b.joints) line(JOINT_LABEL[j.mode], JOINT_HARDWARE[j.mode], j.count);
  }
  line('');
  line('Total pipe by size');
  for (const [size, total] of Object.entries(b.totalBySize)) {
    line(size, formatLengthDisplay(total ?? 0, disp));
  }
  if (b.conflicts > 0) {
    line('');
    line('Conflicts', b.conflicts);
  }
  return `${rows.join('\n')}\n`;
}
