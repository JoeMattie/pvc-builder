// Bill of materials / cut-list (planfile §8). Pure: per-pipe cut length =
// centre-to-centre span minus each end's fitting take-off; fitting counts by
// type + size; and for formed pipes the developed length + bend schedule. The
// math is exact for the sourced/estimated fabrication metadata returned with
// each row. No three/UI types. Hand-rolled CSV.

import { dot, sub } from '../geometry/math3';
import {
  type Design,
  type FabricationMeasurement,
  type FabricationSource,
  type JointMode,
  type NominalSize,
  pipeSpec,
} from '../schema';
import { formatLengthDisplay } from '../ui/units';
import { memberById, memberLengthM, nodeById } from './docOps';
import { type FittingType, resolveFittings } from './fittings';
import { analyzeFormed } from './formed';

/** An eye-bolt + knotted cord shortens each pipe end at a FREE (ball) pivot — a
 * documented ESTIMATE take-off (≈1"), like the fitting take-offs above. */
export const EYE_BOLT_TAKEOFF_M = 0.0254;

const PVC_BUILDER_ESTIMATE: Omit<FabricationSource, 'note'> = {
  basis: 'estimate',
  label: 'PVC Builder estimate',
};

const PVC_BUILDER_MODEL: Omit<FabricationSource, 'note'> = {
  basis: 'model',
  label: 'PVC Builder model',
};

const estimate = (valueM: number, note: string): FabricationMeasurement => ({
  valueM,
  source: { ...PVC_BUILDER_ESTIMATE, note },
});

const modelValue = (valueM: number, note: string): FabricationMeasurement => ({
  valueM,
  source: { ...PVC_BUILDER_MODEL, note },
});

export const EYE_BOLT_TAKEOFF: FabricationMeasurement = estimate(
  EYE_BOLT_TAKEOFF_M,
  'free-pivot eye bolt + cord setback, verify against selected hardware',
);

// Fitting centre-to-face ÷ pipe OD — an ESTIMATE of how far the fitting body
// eats into the centre-to-centre run past the socket. Replace with Spears /
// manufacturer SCH 40 take-off tables when available; the cut-list math is
// exact for whatever these are. Couplings/reducers butt at the centre (≈0).
const CENTRE_TO_FACE_FACTOR: Partial<Record<FittingType, number>> = {
  elbow90: 1.2,
  elbow45: 0.95,
  elbow3way: 1.2, // corner elbow — body eats in like a 90° elbow on each axis
  tee: 1.2,
  cross: 1.2,
};

type FittingTakeoffKey = NonNullable<ReturnType<typeof pipeSpec>['fittingTakeoffs']>;

const FITTING_TAKEOFF_KEYS: Partial<Record<FittingType, keyof FittingTakeoffKey>> = {
  elbow90: 'elbow90',
  elbow45: 'elbow45',
  elbow3way: 'elbow3way',
  tee: 'teeRun',
  cross: 'cross',
};

/** How much a fitting shortens a pipe end from the centre-to-centre length. */
export function fittingTakeoffDetail(type: FittingType, size: NominalSize): FabricationMeasurement {
  const spec = pipeSpec(size);
  const key = FITTING_TAKEOFF_KEYS[type];
  const sourced = key ? spec.fittingTakeoffs?.[key] : undefined;
  if (sourced) return sourced;

  const factor = CENTRE_TO_FACE_FACTOR[type];
  if (!factor) {
    return modelValue(
      0,
      `${type} cut model keeps pipe ends at the drawn joint center; verify specialty couplings/reducers if exact stop gaps matter`,
    );
  }
  return estimate(
    Math.max(0, factor * spec.odM - spec.socketDepthM),
    `${type} fallback uses ${factor} * OD - socket depth because no sourced take-off is available`,
  );
}

/** Numeric-only compatibility helper for older BOM/scene callers. */
export function fittingTakeoffM(type: FittingType, size: NominalSize): number {
  return fittingTakeoffDetail(type, size).valueM;
}

// A wrapped union is FABRICATED: the mover pipe is heat-squished flat, wrapped
// once around the receiver (≈ its circumference), returned, un-squished, and a
// bolt is driven through both. That eats extra length of the MOVER pipe. These
// are documented ESTIMATES, deliberately padded LONG (cut shorter if needed).
const WRAP_BOLT_CLEARANCE_M = 0.0254; // ~1" for the through-bolt
const WRAP_PAD = 1.15; // 15% longer than the bare estimate
/** Extra mover-pipe length a wrapped union needs, given the RECEIVER it wraps. */
export function wrapAllowanceM(receiverSize: NominalSize): number {
  const od = pipeSpec(receiverSize).odM;
  // squish + wrap-around (πD) + return/un-squish (~2D) + bolt clearance
  return (Math.PI * od + 2 * od + WRAP_BOLT_CLEARANCE_M) * WRAP_PAD;
}
export function wrapAllowanceDetail(receiverSize: NominalSize): FabricationMeasurement {
  return estimate(
    wrapAllowanceM(receiverSize),
    `heat-wrap allowance for wrapping around ${receiverSize} receiver: (pi * OD + 2 * OD + 1" clearance) * 1.15`,
  );
}
/** A pipe whose END receives a wrap is extended 1" + 1 radius for an end cap so
 * the wrap can't slide off the end. */
export function endCapAllowanceM(size: NominalSize): number {
  return 0.0254 + pipeSpec(size).odM / 2;
}
export function endCapAllowanceDetail(size: NominalSize): FabricationMeasurement {
  return estimate(
    endCapAllowanceM(size),
    `wrapped receiver end cap allowance for ${size}: 1" stop plus pipe radius`,
  );
}

const NO_TAKEOFF = modelValue(0, 'open pipe end; no fitting take-off');
const NO_ALLOWANCE = modelValue(0, 'no fabricated allowance on this cut');

export interface BendScheduleItem {
  /** 1-based bend label for shop output */
  bend: number;
  /** turn angle at the bend */
  deflectionRad: number;
  /** bend-plane rotation relative to previous bend */
  dihedralRad: number;
  /** specified heat-bend radius, 0 when unspecified */
  radiusM: number;
  /** recommended minimum radius for this pipe size */
  minRadiusM: number;
  /** radius is below the recommended minimum */
  belowMin: boolean;
}

export interface CutItem {
  memberId: string;
  size: NominalSize;
  kind: 'straight' | 'formed';
  /** centre-to-centre span (straight) or developed centre-line (formed), m */
  spanM: number;
  /** base + wrap allowance + end cap — the length to cut, m */
  cutLengthM: number;
  takeoffAM: number;
  takeoffBM: number;
  takeoffASource: FabricationSource;
  takeoffBSource: FabricationSource;
  /** extra length for wrapped-union fabrication (this pipe wraps a receiver), m */
  wrapAllowanceM: number;
  wrapAllowanceSource: FabricationSource;
  /** extra length for an end cap where this pipe's end receives a wrap, m */
  endCapM: number;
  endCapSource: FabricationSource;
  /** formed only: bend-plane rotations (fabrication schedule), radians */
  bendsRad?: number[];
  /** formed only: richer shop bend schedule */
  bendSchedule?: BendScheduleItem[];
  /** set when a run is CUT into pieces by a manufactured on-body union (a real
   * socket tee is inserted): the 0-based segment index of this piece. Absent for
   * an un-split member. */
  segment?: number;
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

export interface BomWarning {
  key: string;
  severity: 'assumption' | 'fabrication';
  message: string;
}

export interface Bom {
  cuts: CutItem[];
  fittings: FittingLine[];
  /** joint hardware counts by mode (wrapped / free / anchor) */
  joints: JointLine[];
  conflicts: number;
  warnings: BomWarning[];
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

  const endTakeoff = (
    fittingNode: string | undefined,
    size: NominalSize,
  ): FabricationMeasurement => {
    const f = fittingNode ? fittingByNode.get(fittingNode) : undefined;
    if (f) return fittingTakeoffDetail(f.type, size);
    return fittingNode && freeNodes.has(fittingNode) ? EYE_BOLT_TAKEOFF : NO_TAKEOFF;
  };

  // wrapped-union fabrication add-ons: the MOVER wraps the receiver (+ allowance),
  // and a wrap at a RECEIVER's own endpoint needs an end cap on that receiver
  const wrapAdd = new Map<string, FabricationMeasurement>();
  const capAdd = new Map<string, FabricationMeasurement>();
  const addMeasurement = (
    map: Map<string, FabricationMeasurement>,
    key: string,
    next: FabricationMeasurement,
  ) => {
    const prev = map.get(key);
    if (!prev) {
      map.set(key, next);
      return;
    }
    map.set(key, {
      valueM: prev.valueM + next.valueM,
      source: {
        ...next.source,
        note: `${prev.source.note ?? prev.source.label}; ${next.source.note ?? next.source.label}`,
      },
    });
  };
  for (const j of design.joints) {
    if (j.mode !== 'wrapped') continue;
    const recv = memberById(design, j.receiver);
    if (recv?.kind !== 'straight' || !memberById(design, j.mover)) continue;
    addMeasurement(wrapAdd, j.mover, wrapAllowanceDetail(recv.size));
    if (recv.nodeA === j.nodeId || recv.nodeB === j.nodeId) {
      addMeasurement(capAdd, j.receiver, endCapAllowanceDetail(recv.size));
    }
  }

  // manufactured ON-BODY unions insert a real socket tee into an INTACT run, so
  // that run pipe is physically CUT into pieces at each such branch. Collect the
  // split points (fraction along the receiver's nodeA→nodeB) + the fitting take-off
  // both new ends socket into.
  const splitAt = new Map<string, { t: number; takeoff: FabricationMeasurement }[]>();
  for (const j of design.joints) {
    if (!j.manufactured || !j.onBody) continue;
    const recv = memberById(design, j.receiver);
    if (recv?.kind !== 'straight') continue;
    const a = nodeById(design, recv.nodeA)?.position;
    const b = nodeById(design, recv.nodeB)?.position;
    const p = nodeById(design, j.nodeId)?.position;
    if (!a || !b || !p) continue;
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    if (l2 < 1e-9) continue;
    const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
    if (t <= 1e-4 || t >= 1 - 1e-4) continue; // effectively at an end → no split
    const list = splitAt.get(recv.id) ?? [];
    list.push({ t, takeoff: fittingTakeoffDetail('tee', recv.size) });
    splitAt.set(recv.id, list);
  }

  const push = (c: CutItem) => {
    cuts.push(c);
    totalBySize[c.size] = (totalBySize[c.size] ?? 0) + c.cutLengthM;
  };

  for (const m of design.members) {
    const takeoffA = endTakeoff(m.nodeA, m.size);
    const takeoffB = endTakeoff(m.nodeB, m.size);
    const takeoffAM = takeoffA.valueM;
    const takeoffBM = takeoffB.valueM;
    const wrapAllowance = wrapAdd.get(m.id) ?? NO_ALLOWANCE;
    const endCap = capAdd.get(m.id) ?? NO_ALLOWANCE;

    // a straight run split by manufactured on-body tees → one cut piece per segment
    const splits = m.kind === 'straight' ? splitAt.get(m.id) : undefined;
    if (splits?.length) {
      const full = memberLengthM(design, m);
      const sorted = [...splits].sort((x, y) => x.t - y.t);
      // boundaries: run end A, each tee, run end B — each carries the take-off its
      // adjacent segment loses at that end
      const bounds = [
        { t: 0, takeoff: takeoffA },
        ...sorted.map((s) => ({ t: s.t, takeoff: s.takeoff })),
        { t: 1, takeoff: takeoffB },
      ];
      for (let k = 0; k < bounds.length - 1; k++) {
        const lo = bounds[k]!;
        const hi = bounds[k + 1]!;
        const spanM = (hi.t - lo.t) * full;
        // the member-level wrap add rides the first segment, the end cap the last,
        // so a split run still totals the same fabrication material
        const wrap = k === 0 ? wrapAllowance : NO_ALLOWANCE;
        const cap = k === bounds.length - 2 ? endCap : NO_ALLOWANCE;
        const cutLengthM =
          Math.max(0, spanM - lo.takeoff.valueM - hi.takeoff.valueM) + wrap.valueM + cap.valueM;
        push({
          memberId: m.id,
          size: m.size,
          kind: 'straight',
          spanM,
          cutLengthM,
          takeoffAM: lo.takeoff.valueM,
          takeoffBM: hi.takeoff.valueM,
          takeoffASource: lo.takeoff.source,
          takeoffBSource: hi.takeoff.source,
          wrapAllowanceM: wrap.valueM,
          wrapAllowanceSource: wrap.source,
          endCapM: cap.valueM,
          endCapSource: cap.source,
          segment: k,
        });
      }
      continue;
    }

    let spanM: number;
    let bendsRad: number[] | undefined;
    let bendSchedule: BendScheduleItem[] | undefined;
    if (m.kind === 'formed') {
      const analysis = analyzeFormed(design, m);
      spanM = analysis?.developedLengthM ?? 0;
      bendsRad = analysis?.bends.map((b) => b.dihedralRad) ?? [];
      bendSchedule = analysis?.bends.map((b) => ({
        bend: b.index + 1,
        deflectionRad: b.deflectionRad,
        dihedralRad: b.dihedralRad,
        radiusM: b.filletRadiusM,
        minRadiusM: analysis.minBendRadiusM,
        belowMin: b.belowMin,
      }));
    } else {
      spanM = memberLengthM(design, m);
    }
    const cutLengthM =
      Math.max(0, spanM - takeoffAM - takeoffBM) + wrapAllowance.valueM + endCap.valueM;
    push({
      memberId: m.id,
      size: m.size,
      kind: m.kind,
      spanM,
      cutLengthM,
      takeoffAM,
      takeoffBM,
      takeoffASource: takeoffA.source,
      takeoffBSource: takeoffB.source,
      wrapAllowanceM: wrapAllowance.valueM,
      wrapAllowanceSource: wrapAllowance.source,
      endCapM: endCap.valueM,
      endCapSource: endCap.source,
      bendsRad,
      bendSchedule,
    });
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

  // joint hardware counts by mode (wrapped / free / anchor). Free joints at one
  // node are a single shared BALL hub (backed by pairwise records — see
  // `makeFreeHub`), so count one ball per free node, not one per record.
  const jointCounts = new Map<JointMode, number>();
  const freeNodesCounted = new Set<string>();
  for (const j of design.joints) {
    if (j.mode === 'free') {
      if (freeNodesCounted.has(j.nodeId)) continue;
      freeNodesCounted.add(j.nodeId);
    }
    jointCounts.set(j.mode, (jointCounts.get(j.mode) ?? 0) + 1);
  }
  const joints: JointLine[] = [...jointCounts.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => a.mode.localeCompare(b.mode));

  return {
    cuts,
    fittings: [...lines.values()].sort((a, b) => a.type.localeCompare(b.type)),
    joints,
    conflicts: conflicts.length,
    warnings: bomWarnings(cuts),
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
  free: 'ball + an eye bolt & cord per pipe',
  anchor: 'heat-wrap + set screws',
};

const EPS = 1e-9;
const RAD2DEG = 180 / Math.PI;

const trim = (v: number, dp: number): string => String(Number(v.toFixed(dp)));

function sourceText(source: FabricationSource): string {
  return `${source.basis}: ${source.label}${source.note ? ` (${source.note})` : ''}`;
}

function cutMeasurements(c: CutItem): Array<{
  label: string;
  valueM: number;
  source: FabricationSource;
}> {
  return [
    { label: 'A take-off', valueM: c.takeoffAM, source: c.takeoffASource },
    { label: 'B take-off', valueM: c.takeoffBM, source: c.takeoffBSource },
    { label: 'wrap allowance', valueM: c.wrapAllowanceM, source: c.wrapAllowanceSource },
    { label: 'end-cap allowance', valueM: c.endCapM, source: c.endCapSource },
  ];
}

export function cutSourceSummary(c: CutItem): string[] {
  return cutMeasurements(c)
    .filter((m) => m.valueM > EPS || m.source.basis === 'estimate')
    .map((m) => `${m.label} ${sourceText(m.source)}`);
}

function bendScheduleCsv(c: CutItem, display: Design['lengthDisplay']): string {
  if (!c.bendSchedule?.length) return '';
  return c.bendSchedule
    .map((b) => {
      const radius =
        b.radiusM > EPS ? formatLengthDisplay(b.radiusM, display) : 'unspecified radius';
      const min = formatLengthDisplay(b.minRadiusM, display);
      const tight = b.belowMin ? `, tight: min ${min}` : '';
      return `B${b.bend}: bend ${trim(b.deflectionRad * RAD2DEG, 1)} deg, twist ${trim(
        b.dihedralRad * RAD2DEG,
        1,
      )} deg, R ${radius}${tight}`;
    })
    .join('; ');
}

function bomWarnings(cuts: CutItem[]): BomWarning[] {
  const warnings: BomWarning[] = [];
  const push = (warning: BomWarning) => {
    if (!warnings.some((w) => w.key === warning.key)) warnings.push(warning);
  };

  cuts.forEach((c, i) => {
    const pipe = `P${i + 1}`;
    for (const m of cutMeasurements(c)) {
      if (m.valueM <= EPS || m.source.basis !== 'estimate') continue;
      push({
        key: `${pipe}:${m.label}:${m.source.label}:${m.source.note ?? ''}`,
        severity: 'assumption',
        message: `${pipe} ${m.label} uses an estimated value; ${m.source.note ?? m.source.label}.`,
      });
    }
    for (const b of c.bendSchedule ?? []) {
      if (!b.belowMin) continue;
      push({
        key: `${pipe}:bend:${b.bend}:tight`,
        severity: 'fabrication',
        message: `${pipe} bend B${b.bend} radius is below the recommended heat-forming minimum.`,
      });
    }
  });
  return warnings;
}

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
  line(
    'Pipe',
    'Size',
    'Type',
    'Span',
    'Take-off A',
    'Take-off B',
    'Wrap/cap allowance',
    'Bend schedule',
    'Sources / assumptions',
    'Cut length',
  );
  b.cuts.forEach((c, i) => {
    line(
      `P${i + 1}`,
      c.size,
      c.segment !== undefined ? `${c.kind} (tee split)` : c.kind,
      formatLengthDisplay(c.spanM, disp),
      formatLengthDisplay(c.takeoffAM, disp),
      formatLengthDisplay(c.takeoffBM, disp),
      formatLengthDisplay(c.wrapAllowanceM + c.endCapM, disp),
      bendScheduleCsv(c, disp),
      cutSourceSummary(c).join('; '),
      formatLengthDisplay(c.cutLengthM, disp),
    );
  });
  if (b.warnings.length) {
    line('');
    line('Warnings');
    line('Severity', 'Message');
    for (const w of b.warnings) line(w.severity, w.message);
  }
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
