// The editing actions the draw/select tools and the __pvc debug hook both call
// — one place so scripted checks drive exactly what the pointer does. Each
// bridges pure snapping (design/snapping) + pure docOps (design/docOps) into
// the appStore (undo/autosave) and transient editorStore.
import {
  addBodyJoint,
  addFormedMember,
  appendPipe,
  connectPipe,
  deleteMember,
  detachMemberEnd as detachMemberEndOp,
  incidentMembers,
  memberEndpoints,
  nodeById,
  reconcileBodyJoints,
  resetJoints as resetJointsOp,
  rotateMember,
  setJoinMode as setJoinModeOp,
  setJointAngle as setJointAngleOp,
  setMemberLengthM,
  setMemberSize as setMemberSizeOp,
  setNodePosition,
  startPath,
  swapReceiver as swapReceiverOp,
  translateMember,
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
  POINT_RADIUS_M,
  type SnapContext,
  type SnapResult,
  snapPoint,
} from '../design/snapping';
import { dot, length, normalize, scale, sub } from '../geometry/math3';
import type { Design, JointMode, LengthDisplay, NominalSize, Quaternion, Vec3 } from '../schema';
import { pipeSpec } from '../schema';
import { solve } from '../solver';
import { useAppStore } from './appStore';
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
    return {
      position,
      kind: `axis-${axis}` as SnapResult['kind'],
      guide: { axis, from: ctx.fromNode, to: position },
    };
  }
  return snapPoint(raw, ctx);
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

/** End the current path (Escape / Enter / right-click / double-click). */
export function finishPath(): void {
  const editor = useEditorStore.getState();
  editor.setDrawingFrom(null);
  editor.setDrawStartWrap(null);
}

/** Snap a formed-tool point: like drawing, with axis inference anchored at the
 * previous committed point. */
export function snapFormedPoint(raw: Vec3): SnapResult {
  const design = useAppStore.getState().current;
  const pts = useEditorStore.getState().formedPoints;
  const fromNode = pts.length ? pts[pts.length - 1] : undefined;
  return snapPoint(raw, {
    nodes: design ? design.nodes.map((n) => ({ id: n.id, position: n.position })) : [],
    segments: design ? segmentsOf(design) : [],
    fromNode,
    ...snapTol(),
  });
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
  useAppStore
    .getState()
    .updateCurrent((d) => addFormedMember(d, a, b, controls, size, filletRadiiM).design);
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
  updateReconciled((d) => setNodePosition(d, nodeId, position));
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
  updateReconciled((d) => setNodePosition(d, movingNodeId, position));
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

/** Set the display-only length format (the units pill). Never changes stored SI. */
export function setLengthDisplay(display: LengthDisplay): void {
  useAppStore.getState().updateCurrent((d) => ({ ...d, lengthDisplay: display }));
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
