// Bill of materials / cut-list (planfile §8). Pure: per-pipe cut length =
// centre-to-centre span minus each end's fitting take-off; fitting counts by
// type + size; and for formed pipes the developed length + bend schedule. The
// take-off math is exact given the fitting take-off constants below (which are
// documented ESTIMATES to be replaced with manufacturer tables). No three/UI
// types. Hand-rolled CSV.

import { dot, sub } from '../geometry/math3';
import { bendDihedralsRad } from '../geometry/pipe';
import { type Design, type JointMode, type NominalSize, pipeSpec } from '../schema';
import { formatLengthDisplay } from '../ui/units';
import { memberById, memberLengthM, nodeById } from './docOps';
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
  elbow3way: 1.2, // corner elbow — body eats in like a 90° elbow on each axis
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
/** A pipe whose END receives a wrap is extended 1" + 1 radius for an end cap so
 * the wrap can't slide off the end. */
export function endCapAllowanceM(size: NominalSize): number {
  return 0.0254 + pipeSpec(size).odM / 2;
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
  /** extra length for wrapped-union fabrication (this pipe wraps a receiver), m */
  wrapAllowanceM: number;
  /** extra length for an end cap where this pipe's end receives a wrap, m */
  endCapM: number;
  /** formed only: bend-plane rotations (fabrication schedule), radians */
  bendsRad?: number[];
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

  // wrapped-union fabrication add-ons: the MOVER wraps the receiver (+ allowance),
  // and a wrap at a RECEIVER's own endpoint needs an end cap on that receiver
  const wrapAdd = new Map<string, number>();
  const capAdd = new Map<string, number>();
  for (const j of design.joints) {
    if (j.mode !== 'wrapped') continue;
    const recv = memberById(design, j.receiver);
    if (recv?.kind !== 'straight' || !memberById(design, j.mover)) continue;
    wrapAdd.set(j.mover, (wrapAdd.get(j.mover) ?? 0) + wrapAllowanceM(recv.size));
    if (recv.nodeA === j.nodeId || recv.nodeB === j.nodeId) {
      capAdd.set(j.receiver, (capAdd.get(j.receiver) ?? 0) + endCapAllowanceM(recv.size));
    }
  }

  // manufactured ON-BODY unions insert a real socket tee into an INTACT run, so
  // that run pipe is physically CUT into pieces at each such branch. Collect the
  // split points (fraction along the receiver's nodeA→nodeB) + the fitting take-off
  // both new ends socket into.
  const splitAt = new Map<string, { t: number; takeoffM: number }[]>();
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
    list.push({ t, takeoffM: fittingTakeoffM('tee', recv.size) });
    splitAt.set(recv.id, list);
  }

  const push = (c: CutItem) => {
    cuts.push(c);
    totalBySize[c.size] = (totalBySize[c.size] ?? 0) + c.cutLengthM;
  };

  for (const m of design.members) {
    const takeoffAM = endTakeoff(m.nodeA, m.size);
    const takeoffBM = endTakeoff(m.nodeB, m.size);
    const wrapAllowance = wrapAdd.get(m.id) ?? 0;
    const endCap = capAdd.get(m.id) ?? 0;

    // a straight run split by manufactured on-body tees → one cut piece per segment
    const splits = m.kind === 'straight' ? splitAt.get(m.id) : undefined;
    if (splits?.length) {
      const full = memberLengthM(design, m);
      const sorted = [...splits].sort((x, y) => x.t - y.t);
      // boundaries: run end A, each tee, run end B — each carries the take-off its
      // adjacent segment loses at that end
      const bounds = [
        { t: 0, takeoff: takeoffAM },
        ...sorted.map((s) => ({ t: s.t, takeoff: s.takeoffM })),
        { t: 1, takeoff: takeoffBM },
      ];
      for (let k = 0; k < bounds.length - 1; k++) {
        const lo = bounds[k]!;
        const hi = bounds[k + 1]!;
        const spanM = (hi.t - lo.t) * full;
        // the member-level wrap add rides the first segment, the end cap the last,
        // so a split run still totals the same fabrication material
        const wrap = k === 0 ? wrapAllowance : 0;
        const cap = k === bounds.length - 2 ? endCap : 0;
        const cutLengthM = Math.max(0, spanM - lo.takeoff - hi.takeoff) + wrap + cap;
        push({
          memberId: m.id,
          size: m.size,
          kind: 'straight',
          spanM,
          cutLengthM,
          takeoffAM: lo.takeoff,
          takeoffBM: hi.takeoff,
          wrapAllowanceM: wrap,
          endCapM: cap,
          segment: k,
        });
      }
      continue;
    }

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
    const cutLengthM = Math.max(0, spanM - takeoffAM - takeoffBM) + wrapAllowance + endCap;
    push({
      memberId: m.id,
      size: m.size,
      kind: m.kind,
      spanM,
      cutLengthM,
      takeoffAM,
      takeoffBM,
      wrapAllowanceM: wrapAllowance,
      endCapM: endCap,
      bendsRad,
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
