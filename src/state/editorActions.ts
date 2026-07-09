// The editing actions the draw/select tools and the __pvc debug hook both call
// — one place so scripted checks drive exactly what the pointer does. Each
// bridges pure snapping (design/snapping) + pure docOps (design/docOps) into
// the appStore (undo/autosave) and transient editorStore.
import {
  addBodyJoint,
  addControlPointAt,
  addFormedMember,
  addMeasurement,
  appendPipe,
  bendMember,
  connectPipe,
  deleteMember,
  detachMemberEnd as detachMemberEndOp,
  incidentMembers,
  makeFreeHub as makeFreeHubOp,
  makeManufacturedJoint as makeManufacturedJointOp,
  measurementEndPos,
  measurePerp,
  memberEndpoints,
  moveControlPoint,
  nodeById,
  reconcileBodyJoints,
  removeMeasurement,
  resetJoints as resetJointsOp,
  rotateMember,
  setJoinMode as setJoinModeOp,
  setJointAngle as setJointAngleOp,
  setMeasurementOffset,
  setMemberLengthM,
  setMemberSize as setMemberSizeOp,
  setNodePosition,
  startPath,
  swapReceiver as swapReceiverOp,
  translateMember,
  weldNodes,
} from '../design/docOps';
import {
  lengthFromGrabDrag,
  lockToNearestAxis,
  lockToNearestDirection,
  nearestAxisKey,
} from '../design/dragMath';
import { MIN_BEND_RADIUS_FACTOR } from '../design/formed';
import {
  AXIS_BAND_M,
  closestPointOnSegment,
  POINT_RADIUS_M,
  planeCardinalFromCursor,
  type SnapContext,
  type SnapResult,
  snapPoint,
} from '../design/snapping';
import { add, dot, length, normalize, scale, sub } from '../geometry/math3';
import type {
  Design,
  JointMode,
  LengthDisplay,
  MeasurementEnd,
  NominalSize,
  Quaternion,
  Vec3,
} from '../schema';
import { pipeSpec } from '../schema';
import { solve } from '../solver';
import { useAppStore } from './appStore';
import { faceView, stashPose, unstashPose } from './cameraStore';
import { useEditorStore } from './editorStore';

const IDENTITY_Q: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** The stored angle of every wrapped pivot as the solver's input map. */
export function pivotAnglesOf(design: Design): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of design.joints) if (j.mode === 'wrapped') out[j.id] = j.angleRad ?? 0;
  return out;
}

/** The stored orientation of every free (ball) pivot as the solver's input map. */
export function jointOrientationsOf(design: Design): Record<string, Quaternion> {
  const out: Record<string, Quaternion> = {};
  for (const j of design.joints) if (j.mode === 'free') out[j.id] = j.orientation ?? IDENTITY_Q;
  return out;
}

/** Shortest pipe a length drag can leave (one grid step), so a pipe never
 * collapses to zero. */
const MIN_MEMBER_LEN_M = 0.0254;

/** Nothing can be drawn, placed, or dragged below the ground plane (y = 0). */
function clampGround(p: Vec3): Vec3 {
  return p.y < 0 ? { x: p.x, y: 0, z: p.z } : p;
}

/** When a draw plane is active, constrain a point onto it (so drawing — even a
 * snap to an off-plane node — stays in the plane), then keep it above ground. */
function constrainDraw(p: Vec3): Vec3 {
  const dp = useEditorStore.getState().drawPlane;
  if (!dp) return clampGround(p);
  const d = dot(sub(p, dp.origin), dp.normal);
  return clampGround(sub(p, scale(dp.normal, d)));
}

/** Snap tolerances derived from the live snap-pill settings. Ends (nodes) and
 * along-pipe points toggle independently. */
function snapTol(): Pick<SnapContext, 'gridStepM' | 'pointRadiusM' | 'pipeRadiusM' | 'axisBandM'> {
  const s = useEditorStore.getState().snap;
  return {
    gridStepM: s.gridStepM,
    pointRadiusM: s.snapToEnds ? POINT_RADIUS_M : 0,
    pipeRadiusM: s.snapToPipes ? POINT_RADIUS_M : 0,
    axisBandM: s.axisInference ? AXIS_BAND_M : 0,
  };
}

function segmentsOf(design: Design, excludeNode?: string): SnapContext['segments'] {
  const out: SnapContext['segments'] = [];
  for (const m of design.members) {
    if (excludeNode && (m.nodeA === excludeNode || m.nodeB === excludeNode)) continue;
    const e = memberEndpoints(design, m);
    if (!e) continue;
    // only straight members carry an id — an on-pipe hit on a straight can be
    // split to form a tee; formed hits snap to the chord but don't split
    out.push(m.kind === 'straight' ? { ...e, memberId: m.id } : e);
  }
  return out;
}

/** Snap context for the draw tool: all nodes + segments, with axis inference
 * anchored at the current path start. */
export function buildDrawSnapContext(): SnapContext {
  const design = useAppStore.getState().current;
  const fromId = useEditorStore.getState().drawingFromNodeId;
  const from = design && fromId ? nodeById(design, fromId)?.position : undefined;
  return {
    nodes: design ? design.nodes.map((n) => ({ id: n.id, position: n.position })) : [],
    segments: design ? segmentsOf(design) : [],
    fromNode: from,
    ...snapTol(),
  };
}

/** The direction of the segment that ends at the current path cursor, if any —
 * so Shift can offer a lock perpendicular to it. */
function prevSegmentDir(fromId: string | null, fromPos: Vec3): Vec3 | null {
  const design = useAppStore.getState().current;
  if (!design || !fromId) return null;
  const members = incidentMembers(design, fromId);
  const m = members[members.length - 1];
  if (!m) return null;
  const otherId = m.nodeA === fromId ? m.nodeB : m.nodeA;
  const op = nodeById(design, otherId)?.position;
  if (!op) return null;
  const d = sub(fromPos, op);
  return length(d) < 1e-6 ? null : normalize(d);
}

/** Resolve a draw point. `lockAxis` (Shift) locks the point to the nearest of
 * the 3 world axes from the path start OR — when there's a previous segment —
 * the direction perpendicular to it (a right-angle turn in any plane), whichever
 * the cursor runs most along. Overrides proximity inference. */
export function snapDrawPoint(raw: Vec3, lockAxis = false): SnapResult {
  const ctx = buildDrawSnapContext();
  if (lockAxis && ctx.fromNode) {
    const fromId = useEditorStore.getState().drawingFromNodeId;
    const extra: Vec3[] = [];
    const prev = prevSegmentDir(fromId, ctx.fromNode);
    if (prev) {
      // the direction in the plane ⟂ the previous segment nearest the cursor
      const rel = sub(raw, ctx.fromNode);
      const perp = sub(rel, scale(prev, dot(rel, prev)));
      if (length(perp) > 1e-6) extra.push(normalize(perp));
    }
    const { position, dir } = lockToNearestDirection(ctx.fromNode, raw, ctx.gridStepM, extra);
    const axis = nearestAxisKey(dir);
    const clamped = constrainDraw(position);
    return {
      position: clamped,
      kind: `axis-${axis}` as SnapResult['kind'],
      guide: { axis, from: ctx.fromNode, to: clamped },
    };
  }
  const snap = snapPoint(raw, ctx);
  return { ...snap, position: constrainDraw(snap.position) };
}

/** Place the next draw point (pen click): start a path, extend it, or join an
 * existing node. Returns the resolved snap for callers that want feedback. */
export function placeDrawPoint(raw: Vec3, lockAxis = false): SnapResult {
  const app = useAppStore.getState();
  const editor = useEditorStore.getState();
  const snap = snapDrawPoint(raw, lockAxis);
  const size = editor.drawSize;
  const fromId = editor.drawingFromNodeId;
  // landing on a pipe's body (not an end node) forms an on-body tee around that
  // intact run — rigid/screwed (anchor) by default, switchable to a pivot later
  const wrapMember = snap.kind === 'on-pipe' ? snap.onPipeMemberId : undefined;

  if (!fromId) {
    if (snap.kind === 'node' && snap.nodeId) {
      editor.setDrawingFrom(snap.nodeId);
    } else {
      let newId = '';
      app.updateCurrent((d) => {
        const s = startPath(d, snap.position);
        newId = s.nodeId;
        // the branch member doesn't exist yet — remember the run so the on-body
        // union is created once the first segment is drawn
        return s.design;
      });
      editor.setDrawingFrom(newId);
      editor.setDrawStartWrap(wrapMember ?? null);
    }
    return snap;
  }

  if (snap.nodeId === fromId) return snap; // clicked the current cursor — ignore

  // a pending union at the path's on-pipe START node (fromId), now that its first
  // segment exists
  const startWrap = editor.drawStartWrapMember;

  if (snap.kind === 'node' && snap.nodeId) {
    app.updateCurrent((d) => {
      const nd = connectPipe(d, fromId, snap.nodeId as string, size).design;
      return startWrap ? addBodyJoint(nd, startWrap, fromId).design : nd;
    });
    editor.setDrawingFrom(snap.nodeId);
  } else {
    let nextId = '';
    app.updateCurrent((d) => {
      const r = appendPipe(d, fromId, snap.position, size);
      nextId = r.nodeId;
      let nd = wrapMember ? addBodyJoint(r.design, wrapMember, nextId).design : r.design;
      if (startWrap) nd = addBodyJoint(nd, startWrap, fromId).design;
      return nd;
    });
    editor.setDrawingFrom(nextId);
  }
  if (startWrap) editor.setDrawStartWrap(null);
  return snap;
}

/** End the current path (Escape / Enter / right-click / double-click). Prunes a
 * dangling start node — clicking once then aborting leaves a node with no
 * incident member (an invisible orphan), so drop it. */
export function finishPath(): void {
  const editor = useEditorStore.getState();
  const fromId = editor.drawingFromNodeId;
  if (fromId) {
    useAppStore.getState().updateCurrent((d) => {
      const used = d.members.some((m) => m.nodeA === fromId || m.nodeB === fromId);
      return used ? d : { ...d, nodes: d.nodes.filter((n) => n.id !== fromId) };
    });
  }
  editor.setDrawingFrom(null);
  editor.setDrawStartWrap(null);
  editor.setDrawLength('');
  editor.setDrawDirection(null);
}

/** Complete the current draw segment at an EXACT distance (typed into the length
 * pill), along the current draw direction from the path cursor. Returns true if
 * a segment was placed. Used by the Enter-to-commit typed-length flow. */
export function placeDrawAtDistance(distanceM: number): boolean {
  const app = useAppStore.getState();
  const editor = useEditorStore.getState();
  const design = app.current;
  const fromId = editor.drawingFromNodeId;
  const dir = editor.drawDirection;
  if (!design || !fromId || !dir || distanceM <= 0) return false;
  const from = nodeById(design, fromId)?.position;
  const u = normalize(dir);
  if (!from || length(u) < 1e-9) return false;
  const target = clampGround(add(from, scale(u, distanceM)));
  const size = editor.drawSize;
  const startWrap = editor.drawStartWrapMember;
  let nextId = '';
  app.updateCurrent((d) => {
    const r = appendPipe(d, fromId, target, size);
    nextId = r.nodeId;
    let nd = r.design;
    if (startWrap) nd = addBodyJoint(nd, startWrap, fromId).design;
    return reconcileBodyJoints(nd);
  });
  editor.setDrawingFrom(nextId);
  editor.setDrawStartWrap(null);
  editor.setDrawLength('');
  return true;
}

/** Snap a formed-tool point: like drawing, with axis inference anchored at the
 * previous committed point. */
export function snapFormedPoint(raw: Vec3): SnapResult {
  const design = useAppStore.getState().current;
  const pts = useEditorStore.getState().formedPoints;
  const fromNode = pts.length ? pts[pts.length - 1] : undefined;
  const snap = snapPoint(raw, {
    nodes: design ? design.nodes.map((n) => ({ id: n.id, position: n.position })) : [],
    segments: design ? segmentsOf(design) : [],
    fromNode,
    ...snapTol(),
  });
  return { ...snap, position: clampGround(snap.position) };
}

/** Commit a point of the in-progress formed pipe. */
export function placeFormedPoint(raw: Vec3): SnapResult {
  const snap = snapFormedPoint(raw);
  useEditorStore.getState().pushFormedPoint(snap.position);
  return snap;
}

/** Finish the formed pipe: build a heat-bent member through the committed
 * points (start → control points → end). Needs at least two points; each bend
 * gets a default fillet = the pipe's minimum heat-form radius. */
export function finishFormed(): void {
  const editor = useEditorStore.getState();
  const pts = editor.formedPoints;
  if (pts.length < 2) {
    editor.clearFormedPoints();
    return;
  }
  const size = editor.drawSize;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const controls = pts.slice(1, -1);
  const fillet = MIN_BEND_RADIUS_FACTOR * pipeSpec(size).odM;
  const filletRadiiM = controls.map(() => fillet);
  // reconcile so a curve whose ends land on a run auto-form on-body unions and
  // any coincident nodes de-duplicate — a curve joins pipes just like a pipe does
  useAppStore
    .getState()
    .updateCurrent((d) =>
      reconcileBodyJoints(addFormedMember(d, a, b, controls, size, filletRadiiM).design),
    );
  editor.clearFormedPoints();
}

/** Apply a geometry edit, then reconcile on-body unions so connecting /
 * disconnecting a branch happens immediately — even mid-drag. */
function updateReconciled(mutate: (d: Design) => Design): void {
  useAppStore.getState().updateCurrent((d) => reconcileBodyJoints(mutate(d)));
}

export function selectMember(memberId: string): void {
  useEditorStore.getState().setSelection([memberId]);
}

export function clearSelection(): void {
  useEditorStore.getState().setSelection([]);
}

/** Free move of a node to a ground point (the endpoint grab handle). Snaps to
 * other geometry (the dragged node is excluded from its own snap targets).
 * With `opts.lockAxis`, the move is constrained to whichever world axis it runs
 * most along, anchored at `opts.anchor` (the node's position when the drag
 * began) — the Shift behaviour. */
export function dragNodeTo(
  nodeId: string,
  raw: Vec3,
  opts?: { lockAxis?: boolean; anchor?: Vec3 },
): void {
  const design = useAppStore.getState().current;
  if (!design) return;
  let position: Vec3;
  if (opts?.lockAxis && opts.anchor) {
    position = lockToNearestAxis(opts.anchor, raw, snapTol().gridStepM).position;
  } else {
    position = snapPoint(raw, {
      nodes: design.nodes
        .filter((n) => n.id !== nodeId)
        .map((n) => ({ id: n.id, position: n.position })),
      segments: segmentsOf(design, nodeId),
      fromNode: undefined,
      ...snapTol(),
    }).position;
  }
  updateReconciled((d) => setNodePosition(d, nodeId, clampGround(position)));
}

/** Resize a member by dragging one end's arrow along the pipe's own axis: move
 * `movingNodeId` along `axisDir` (unit, pointing away from `fixedEnd`) tracking
 * the cursor's *delta* from the grab, grid-quantized and clamped. `fixedEnd`,
 * `axisDir`, and `grab` (the pipe's length + the cursor's axis projection at the
 * moment of grab) are captured when the drag begins, so the outward-offset arrow
 * head doesn't jump the length on the first move. */
export function dragMemberEndLength(
  movingNodeId: string,
  fixedEnd: Vec3,
  axisDir: Vec3,
  raw: Vec3,
  grab: { startLenM: number; grabProj: number },
): void {
  const grid = snapTol().gridStepM;
  const { position } = lengthFromGrabDrag(
    fixedEnd,
    axisDir,
    raw,
    grab.startLenM,
    grab.grabProj,
    grid,
    MIN_MEMBER_LEN_M,
  );
  updateReconciled((d) => setNodePosition(d, movingNodeId, clampGround(position)));
}

/** Set an exact length on a member (length editor). */
export function setMemberLength(memberId: string, lengthM: number): void {
  updateReconciled((d) => setMemberLengthM(d, memberId, lengthM));
}

/** Translate a whole member by `delta` (the move tool's axis arrows). */
export function translateMemberBy(memberId: string, delta: Vec3): void {
  updateReconciled((d) => translateMember(d, memberId, delta));
}

/** Rotate a whole member about `pivot` around `axis` by `angleRad` (rotate tool). */
export function rotateMemberBy(memberId: string, axis: Vec3, angleRad: number, pivot: Vec3): void {
  updateReconciled((d) => rotateMember(d, memberId, axis, angleRad, pivot));
}

/** Translate several members together by `delta` in one undo step (multi-select
 * move). Shared endpoints move once; distinct members each shift. */
export function translateMembersBy(memberIds: string[], delta: Vec3): void {
  updateReconciled((d) => memberIds.reduce((acc, id) => translateMember(acc, id, delta), d));
}

/** Rotate several members together about a common `pivot`/`axis` (multi-select
 * rotate), one undo step. */
export function rotateMembersBy(
  memberIds: string[],
  axis: Vec3,
  angleRad: number,
  pivot: Vec3,
): void {
  updateReconciled((d) =>
    memberIds.reduce((acc, id) => rotateMember(acc, id, axis, angleRad, pivot), d),
  );
}

/** Delete every selected member in one undo step (multi-select delete). */
export function deleteMembers(memberIds: string[]): void {
  if (memberIds.length === 0) return;
  useAppStore
    .getState()
    .updateCurrent((d) => memberIds.reduce((acc, id) => deleteMember(acc, id), d));
}

/** Switch a pipe's nominal size (right-click size switcher). */
export function setMemberSize(memberId: string, size: NominalSize): void {
  useAppStore.getState().updateCurrent((d) => setMemberSizeOp(d, memberId, size));
}

/** Switch every selected pipe's size in one undo step. */
export function setMembersSize(memberIds: string[], size: NominalSize): void {
  if (memberIds.length === 0) return;
  useAppStore
    .getState()
    .updateCurrent((d) => memberIds.reduce((acc, id) => setMemberSizeOp(acc, id, size), d));
}

/** Break the union at `memberId`'s end at `nodeId` (Ctrl-drag): the end gets its
 * own coincident node so it can move independently. Returns the new node id to
 * drag, or null if nothing detached. Call inside an open gesture. */
export function detachMemberEnd(memberId: string, nodeId: string): string | null {
  const design = useAppStore.getState().current;
  if (!design) return null;
  const r = detachMemberEndOp(design, memberId, nodeId);
  if (r.nodeId === nodeId) return null;
  useAppStore.getState().updateCurrent(() => r.design);
  return r.nodeId;
}

/** Weld node `fromId` back into `intoId` (the inverse of a detach) — used when
 * Ctrl is toggled OFF mid-drag to re-attach a detached end to its shared node.
 * Reconciles so any on-body union heals. */
export function weldNodesInto(fromId: string, intoId: string): void {
  updateReconciled((d) => weldNodes(d, fromId, intoId));
}

/** Set the display-only length format (the units pill). Never changes stored SI. */
export function setLengthDisplay(display: LengthDisplay): void {
  useAppStore.getState().updateCurrent((d) => ({ ...d, lengthDisplay: display }));
}

/** After an endpoint drag settles: if `nodeId` landed exactly on another node,
 * weld the two into one junction (so dropping one pipe end onto another joins
 * them instead of leaving two coincident nodes with overlapping joints). */
const WELD_TOL_M = 1e-4;
export function weldDroppedNode(nodeId: string): void {
  const design = useAppStore.getState().current;
  if (!design) return;
  const dragged = nodeById(design, nodeId);
  if (!dragged) return;
  const other = design.nodes.find(
    (n) => n.id !== nodeId && length(sub(n.position, dragged.position)) < WELD_TOL_M,
  );
  if (!other) return;
  useAppStore.getState().updateCurrent((d) => weldNodes(d, nodeId, other.id));
}

// ── tape measure ────────────────────────────────────────────────────────────

/** Snap a tape-measure point like a draw point (to ends + along pipes), but
 * without axis inference (measurements are free spans). */
export function snapMeasurePoint(raw: Vec3): SnapResult {
  const design = useAppStore.getState().current;
  const snap = snapPoint(raw, {
    nodes: design ? design.nodes.map((n) => ({ id: n.id, position: n.position })) : [],
    segments: design ? segmentsOf(design) : [],
    fromNode: undefined,
    ...snapTol(),
  });
  return { ...snap, position: clampGround(snap.position) };
}

/** Resolve a snap to a measurement end — pinned to a node when snapped to one,
 * else a free point. */
function measureEndOf(snap: SnapResult): MeasurementEnd {
  return snap.kind === 'node' && snap.nodeId
    ? { nodeId: snap.nodeId }
    : { position: snap.position };
}

/** A tape-measure click: place the first end, then the second (which creates the
 * measurement and enters offset-adjust), then confirm the perpendicular offset. */
export function placeMeasurePoint(raw: Vec3): void {
  const design = useAppStore.getState().current;
  const editor = useEditorStore.getState();
  if (!design) return;
  if (editor.measureAdjustId) {
    editor.setMeasureAdjustId(null); // third click confirms the offset
    return;
  }
  const end = measureEndOf(snapMeasurePoint(raw));
  if (!editor.measureFrom) {
    editor.setMeasureFrom(end);
    return;
  }
  const from = editor.measureFrom;
  let id = '';
  useAppStore.getState().updateCurrent((d) => {
    const r = addMeasurement(d, from, end, 0);
    id = r.measurementId;
    return r.design;
  });
  editor.setMeasureFrom(null);
  editor.setMeasureAdjustId(id);
  editor.selectMeasurement(id);
}

/** While adjusting a just-placed measurement, set its dimension-line offset from
 * the cursor's perpendicular distance to the measured axis. */
export function updateMeasureOffset(raw: Vec3): void {
  const editor = useEditorStore.getState();
  const design = useAppStore.getState().current;
  const id = editor.measureAdjustId;
  if (!design || !id) return;
  const m = design.measurements.find((x) => x.id === id);
  if (!m) return;
  const a = measurementEndPos(design, m.a);
  const b = measurementEndPos(design, m.b);
  if (!a || !b) return;
  const perp = measurePerp(a, b);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const off = dot(sub(raw, mid), perp);
  useAppStore.getState().updateCurrent((d) => setMeasurementOffset(d, id, off));
}

/** Bend a straight pipe into a curve (the Bend tool drag): pull the point at
 * parameter `t` by `perpOffset`. Uses the pipe's min heat-form radius as the
 * bend radius and the live "lock end angles" toggle. When the "lock length"
 * toggle is on, `lengthRef` (the pipe's axis + length, captured at gesture
 * start) makes the far end draw IN instead of the pipe growing. */
export function bendMemberAt(
  memberId: string,
  t: number,
  perpOffset: Vec3,
  lengthRef?: { axisDir: Vec3; lengthM: number },
): void {
  const design = useAppStore.getState().current;
  if (!design) return;
  const m = design.members.find((x) => x.id === memberId);
  const size = m?.size ?? '3/4"';
  const fillet = MIN_BEND_RADIUS_FACTOR * pipeSpec(size).odM;
  const ed = useEditorStore.getState();
  const lengthLock = ed.bendLengthLock && lengthRef ? lengthRef : undefined;
  updateReconciled((d) =>
    bendMember(d, memberId, t, perpOffset, fillet, {
      lockEndAngles: ed.bendLockEndAngles,
      lengthLock,
    }),
  );
}

/** Move a formed member's control point (the Bend tool's tweak handles),
 * clamped to the ground. */
export function moveFormedControlPoint(memberId: string, index: number, raw: Vec3): void {
  updateReconciled((d) => moveControlPoint(d, memberId, index, clampGround(raw)));
}

/** Add a control point to a formed pipe where the tube was clicked (Bend tool). */
export function addFormedControlPoint(memberId: string, raw: Vec3): void {
  useAppStore.getState().updateCurrent((d) => addControlPointAt(d, memberId, clampGround(raw)));
}

/** Delete a measurement. */
export function deleteMeasurement(id: string): void {
  useAppStore.getState().updateCurrent((d) => removeMeasurement(d, id));
  const editor = useEditorStore.getState();
  if (editor.selectedMeasurementId === id) editor.selectMeasurement(null);
}

// ── draw-on-plane tool ──────────────────────────────────────────────────────

/** Snap a plane-setup point (to ends + along pipes), clamped to the ground. */
export function snapPlanePoint(raw: Vec3): SnapResult {
  const design = useAppStore.getState().current;
  const snap = snapPoint(raw, {
    nodes: design ? design.nodes.map((n) => ({ id: n.id, position: n.position })) : [],
    segments: design ? segmentsOf(design) : [],
    fromNode: undefined,
    ...snapTol(),
  });
  return { ...snap, position: clampGround(snap.position) };
}

/** Horizontal directions of straight pipes touching `origin` — an endpoint AT
 * the origin, or a run whose span passes through it — used as extra draw-plane
 * cardinals so a wall can align to an existing pipe. */
function incidentPipeDirsAt(origin: Vec3): Vec3[] {
  const design = useAppStore.getState().current;
  if (!design) return [];
  const TOL = 1e-3;
  const dirs: Vec3[] = [];
  for (const m of design.members) {
    if (m.kind !== 'straight') continue;
    const a = nodeById(design, m.nodeA)?.position;
    const b = nodeById(design, m.nodeB)?.position;
    if (!a || !b) continue;
    if (length(sub(a, origin)) < TOL) dirs.push(sub(b, a));
    else if (length(sub(b, origin)) < TOL) dirs.push(sub(a, b));
    else if (length(sub(closestPointOnSegment(origin, a, b), origin)) < TOL) dirs.push(sub(b, a));
  }
  return dirs;
}

/** The vertical draw plane's normal, from the cursor direction relative to the
 * origin, snapped to the nearest cardinal — the world axes (±X / ±Z) plus the
 * horizontal direction (and perpendicular) of any pipe touching the origin. The
 * plane contains that horizontal direction and the Y (up) axis — you draw "up a
 * wall", optionally aligned to an existing pipe. */
export function planeNormalFromCursor(origin: Vec3, cursor: Vec3): Vec3 {
  const offset = { x: cursor.x - origin.x, y: 0, z: cursor.z - origin.z };
  return planeCardinalFromCursor(offset, incidentPipeDirsAt(origin)).normal;
}

/** Enter draw-on-plane mode: stash the camera, flip it to face the plane, and
 * switch to the draw tool constrained to the plane. */
function enterDrawPlane(origin: Vec3, normal: Vec3): void {
  const editor = useEditorStore.getState();
  editor.setDrawPlane({ origin, normal });
  editor.setPlaneOrigin(null);
  stashPose();
  faceView([origin.x, origin.y, origin.z], [normal.x, normal.y, normal.z]);
  editor.setTool('draw');
}

/** Exit draw-on-plane mode: drop the plane + restore the previous camera. */
export function exitDrawPlane(): void {
  const editor = useEditorStore.getState();
  if (!editor.drawPlane && !editor.planeOrigin) return;
  editor.setDrawPlane(null);
  editor.setPlaneOrigin(null);
  editor.setDrawingFrom(null);
  unstashPose();
}

/** A plane-tool click: 1st sets the origin; 2nd sets the angle + enters mode. */
export function placePlanePoint(raw: Vec3): void {
  const editor = useEditorStore.getState();
  const snap = snapPlanePoint(raw);
  if (!editor.planeOrigin) {
    editor.setPlaneOrigin(snap.position);
    return;
  }
  enterDrawPlane(editor.planeOrigin, planeNormalFromCursor(editor.planeOrigin, snap.position));
}

// ── joints (right-click a pipe join → wrapped / free / anchor) ──────────────

/** Set member `moverId`'s connection mode at `nodeId` — the right-click join
 * menu (and the __pvc hook) call this. `receiverId` overrides the auto-picked
 * receiver for a wrapped pivot. */
export function setJoinMode(
  nodeId: string,
  moverId: string,
  mode: JointMode,
  receiverId?: string,
): void {
  useAppStore.getState().updateCurrent((d) => setJoinModeOp(d, nodeId, moverId, mode, receiverId));
}

/** Swap which pipe wraps which (a wrapped end-to-end joint's ⇄ control). */
export function swapJointReceiver(jointId: string): void {
  useAppStore.getState().updateCurrent((d) => swapReceiverOp(d, jointId));
}

/** Replace a joint with a MANUFACTURED fitting: snap the mover to the nearest
 * standard angle + drop the pivot record (the join menu's "Manufactured"). */
export function makeManufacturedJoint(nodeId: string, moverId: string): void {
  updateReconciled((d) => makeManufacturedJointOp(d, nodeId, moverId));
}

/** Make `nodeId` a shared FREE (ball) hub: every straight pipe ending there
 * pivots about the one point (the join menu's "Free hub" / multi-pipe "Free"). */
export function makeFreeHub(nodeId: string): void {
  updateReconciled((d) => makeFreeHubOp(d, nodeId));
}

/** Set a wrapped pivot's angle (the angle slider). In a locked mechanism with
 * closed loops, driving one pivot pushes the others: after setting the driven
 * angle we solve and write back every OTHER wrapped joint's resolved angle (the
 * driven one stays put), so the loop stays closed and the passive sliders track.
 * For open chains the solve is an identity, so this is a no-op there. */
export function setPivotAngle(jointId: string, angleRad: number): void {
  useAppStore.getState().updateCurrent((d) => {
    const next = setJointAngleOp(d, jointId, angleRad);
    if (!next.lengthsLocked || next.joints.length < 2) return next;
    const r = solve(
      next,
      {
        lengthsLocked: true,
        pivotAngles: pivotAnglesOf(next),
        jointOrientations: jointOrientationsOf(next),
      },
      'pose',
    );
    return {
      ...next,
      joints: next.joints.map((j) =>
        j.id === jointId || j.mode !== 'wrapped'
          ? j
          : { ...j, angleRad: r.pivotAngles[j.id] ?? j.angleRad ?? 0 },
      ),
    };
  });
}

/** Reset all pivot joints to their rest pose. */
export function resetPivots(): void {
  useAppStore.getState().updateCurrent((d) => resetJointsOp(d));
}

/** Drag-to-rotate in locked mode: run IK so `nodeId` follows the ground point,
 * writing the resolved wrapped angles + free orientations back to the document. */
export function dragLocked(nodeId: string, ground: Vec3): void {
  const design = useAppStore.getState().current;
  if (!design) return;
  const r = solve(
    design,
    {
      lengthsLocked: true,
      pivotAngles: pivotAnglesOf(design),
      jointOrientations: jointOrientationsOf(design),
      dragTarget: { nodeId, position: ground },
    },
    'pose',
  );
  useAppStore.getState().updateCurrent((d) => ({
    ...d,
    joints: d.joints.map((j) => {
      if (j.mode === 'wrapped') return { ...j, angleRad: r.pivotAngles[j.id] ?? j.angleRad ?? 0 };
      if (j.mode === 'free')
        return { ...j, orientation: r.jointOrientations[j.id] ?? j.orientation };
      return j;
    }),
  }));
}
