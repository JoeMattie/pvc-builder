// The editing actions the draw/select tools and the __pvc debug hook both call
// — one place so scripted checks drive exactly what the pointer does. Each
// bridges pure snapping (design/snapping) + pure docOps (design/docOps) into
// the appStore (undo/autosave) and transient editorStore.
import {
  addFormedMember,
  addPivot,
  addWrap,
  appendPipe,
  connectPipe,
  memberEndpoints,
  nodeById,
  resetPivots as resetPivotsOp,
  setMemberLengthM,
  setNodePosition,
  setPivotAngle as setPivotAngleOp,
  rotateMember,
  setWrapRigid as setWrapRigidOp,
  startPath,
  translateMember,
} from '../design/docOps';
import { lengthFromGrabDrag, lockToNearestAxis } from '../design/dragMath';
import { MIN_BEND_RADIUS_FACTOR } from '../design/formed';
import {
  AXIS_BAND_M,
  POINT_RADIUS_M,
  type SnapContext,
  type SnapResult,
  snapPoint,
} from '../design/snapping';
import type { Design, Vec3 } from '../schema';
import { pipeSpec } from '../schema';
import { solve } from '../solver';
import { useAppStore } from './appStore';
import { useEditorStore } from './editorStore';

/** The stored angle of every pivot as the solver's input map. */
export function pivotAnglesOf(design: Design): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of design.pivots) out[p.id] = p.angleRad ?? 0;
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

/** Resolve a draw point. `lockAxis` (Shift) forces the point onto whichever
 * world axis from the path start it runs most along, overriding proximity-based
 * inference. */
export function snapDrawPoint(raw: Vec3, lockAxis = false): SnapResult {
  const ctx = buildDrawSnapContext();
  if (lockAxis && ctx.fromNode) {
    const { position, axis } = lockToNearestAxis(ctx.fromNode, raw, ctx.gridStepM);
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
  // landing on a pipe's body (not an end node) forms a heat-wrapped tee around
  // that intact run — rigid/screwed by default, switchable to a pivot later
  const wrapMember = snap.kind === 'on-pipe' ? snap.onPipeMemberId : undefined;

  if (!fromId) {
    if (snap.kind === 'node' && snap.nodeId) {
      editor.setDrawingFrom(snap.nodeId);
    } else {
      let newId = '';
      app.updateCurrent((d) => {
        const s = startPath(d, snap.position);
        newId = s.nodeId;
        return wrapMember ? addWrap(s.design, wrapMember, newId).design : s.design;
      });
      editor.setDrawingFrom(newId);
    }
    return snap;
  }

  if (snap.nodeId === fromId) return snap; // clicked the current cursor — ignore

  if (snap.kind === 'node' && snap.nodeId) {
    app.updateCurrent((d) => connectPipe(d, fromId, snap.nodeId as string, size).design);
    editor.setDrawingFrom(snap.nodeId);
  } else {
    let nextId = '';
    app.updateCurrent((d) => {
      const r = appendPipe(d, fromId, snap.position, size);
      nextId = r.nodeId;
      return wrapMember ? addWrap(r.design, wrapMember, nextId).design : r.design;
    });
    editor.setDrawingFrom(nextId);
  }
  return snap;
}

/** End the current path (Escape / Enter / right-click / double-click). */
export function finishPath(): void {
  useEditorStore.getState().setDrawingFrom(null);
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
  useAppStore.getState().updateCurrent((d) => setNodePosition(d, nodeId, position));
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
  useAppStore.getState().updateCurrent((d) => setNodePosition(d, movingNodeId, position));
}

/** Set an exact length on a member (length editor). */
export function setMemberLength(memberId: string, lengthM: number): void {
  useAppStore.getState().updateCurrent((d) => setMemberLengthM(d, memberId, lengthM));
}

/** Translate a whole member by `delta` (the move tool's axis arrows). */
export function translateMemberBy(memberId: string, delta: Vec3): void {
  useAppStore.getState().updateCurrent((d) => translateMember(d, memberId, delta));
}

/** Rotate a whole member about `pivot` around `axis` by `angleRad` (rotate tool). */
export function rotateMemberBy(
  memberId: string,
  axis: Vec3,
  angleRad: number,
  pivot: Vec3,
): void {
  useAppStore.getState().updateCurrent((d) => rotateMember(d, memberId, axis, angleRad, pivot));
}

// ── pivots (Phase 4) ────────────────────────────────────────────────────────

/** Turn a 2-member node into a heat-formed pivot (the pivot tool). */
export function createPivotAt(nodeId: string): void {
  useAppStore.getState().updateCurrent((d) => addPivot(d, nodeId).design);
}

/** Set a pivot's angle (the angle slider). */
export function setPivotAngle(pivotId: string, angleRad: number): void {
  useAppStore.getState().updateCurrent((d) => setPivotAngleOp(d, pivotId, angleRad));
}

/** Reset all pivots to their rest angle. */
export function resetPivots(): void {
  useAppStore.getState().updateCurrent((d) => resetPivotsOp(d));
}

// ── heat-wrapped tees ───────────────────────────────────────────────────────

/** Switch a wrap between rigid (screwed) and a natural pivot. */
export function setWrapRigid(wrapId: string, rigid: boolean): void {
  useAppStore.getState().updateCurrent((d) => setWrapRigidOp(d, wrapId, rigid));
}

/** Drag-to-rotate in locked mode: run IK so `nodeId` follows the ground point,
 * writing the resolved pivot angles back to the document. */
export function dragLocked(nodeId: string, ground: Vec3): void {
  const design = useAppStore.getState().current;
  if (!design) return;
  const r = solve(
    design,
    {
      lengthsLocked: true,
      pivotAngles: pivotAnglesOf(design),
      dragTarget: { nodeId, position: ground },
    },
    'pose',
  );
  useAppStore.getState().updateCurrent((d) => ({
    ...d,
    pivots: d.pivots.map((p) => ({ ...p, angleRad: r.pivotAngles[p.id] ?? p.angleRad ?? 0 })),
  }));
}
