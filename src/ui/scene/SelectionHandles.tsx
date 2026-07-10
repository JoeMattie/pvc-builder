import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Ray } from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { closestAxisPointToRay } from '../../design/dragMath';
import { add, cross, dot, length, normalize, scale, sub } from '../../geometry/math3';
import { type Design, type LengthDisplay, pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import {
  detachMemberEnd,
  dragLocked,
  dragMemberEndLength,
  dragNodeTo,
  rotateMembersBy,
  translateMembersBy,
  weldDroppedNode,
  weldNodesInto,
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formatLengthDisplay } from '../units';
import { orientY, orientZ } from './axis';
import { rayToPlane } from './ground';
import { CLICK_SLOP_PX, useGroundDrag } from './interactions';
import { pickSnapPoint, SNAP_PX, snapDebug } from './pipePick';

/** A small floating "↥ height above ground" pill, shown while a point is being
 * moved vertically (planfile: show distance from ground on a Y move). */
function HeightPill({
  pos,
  night,
  display,
}: {
  pos: Vec3;
  night: boolean;
  display: LengthDisplay | undefined;
}) {
  return (
    <Html position={[pos.x, pos.y, pos.z]} center zIndexRange={[100, 0]}>
      <div
        style={{
          padding: '2px 6px',
          borderRadius: 6,
          font: "500 12px 'IBM Plex Mono', monospace",
          background: night ? '#1e2128' : '#fff',
          color: night ? '#e8eaf0' : '#1a1d24',
          border: `1px solid ${night ? '#33363f' : '#e4e4e7'}`,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          transform: 'translate(14px, -14px)',
        }}
      >
        ↥ {formatLengthDisplay(pos.y, display)}
      </div>
    </Html>
  );
}

/** Endpoint grab sphere: free move of the junction on the ground, one undo
 * step. Hold Shift to lock the move to a world axis. Hold Ctrl to break the
 * union — the SELECTED pipe's end (`memberId`) detaches to its own node and
 * moves alone (snapping along a pipe under the cursor), leaving the others put.
 * When lengths are locked, the drag runs pivot IK instead (drag-to-rotate). */
function MoveHandle({
  nodeId,
  memberId,
  pos,
  radiusM,
  locked,
  night,
  display,
}: {
  nodeId: string;
  memberId: string;
  pos: Vec3;
  radiusM: number;
  locked: boolean;
  night: boolean;
  display: LengthDisplay | undefined;
}) {
  const anchor = useRef<Vec3 | null>(null);
  const dragId = useRef<string>(nodeId);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const { start, dragging } = useGroundDrag(
    (g, mods, ev) => {
      // Ctrl is a live toggle between "move the shared node" and "detach this
      // member's end and move it alone" — so pressing/releasing Ctrl mid-drag
      // breaks the union or re-welds it, both inside the drag's single gesture.
      if (!locked) {
        const detached = dragId.current !== nodeId;
        if (mods.ctrl && !detached) {
          dragId.current = detachMemberEnd(memberId, nodeId) ?? nodeId;
        } else if (!mods.ctrl && detached) {
          weldNodesInto(dragId.current, nodeId); // re-attach to the shared node
          dragId.current = nodeId;
        }
      }
      const id = dragId.current;
      if (locked) return dragLocked(id, g);
      // snap the endpoint onto a node/pipe the cursor is over (screen-space, any
      // height) so dropping it forms a tee / weld — unless Shift-locked to an axis
      let target = g;
      if (!mods.shift) {
        const design = useAppStore.getState().current;
        const snap = useEditorStore.getState().snap;
        const hit = design
          ? pickSnapPoint(camera, gl.domElement, design, ev.clientX, ev.clientY, SNAP_PX, {
              excludeNode: id,
              nodes: snap.snapToEnds,
              pipes: snap.snapToPipes,
            })
          : null;
        if (snapDebug()) {
          console.log(
            '[drag-snap]',
            hit ? `${hit.kind} ${hit.id} @${hit.distPx.toFixed(1)}px` : 'none',
          );
        }
        if (hit) target = hit.point;
      }
      return dragNodeTo(id, target, { lockAxis: mods.shift, anchor: anchor.current ?? undefined });
    },
    // free move rides a view-facing plane through the node so a floating node
    // keeps its height; locked-mode IK stays on the ground plane
    {
      viewPlaneOrigin: () => (locked ? null : pos),
      // on drop, weld the endpoint onto a coincident node (join two pipe ends)
      onEnd: locked ? undefined : () => weldDroppedNode(dragId.current),
    },
  );
  return (
    <>
      <mesh
        position={[pos.x, pos.y, pos.z]}
        onPointerDown={(e) => {
          anchor.current = pos;
          dragId.current = nodeId;
          start(e);
        }}
      >
        {/* slightly smaller than the hit radius + partially transparent */}
        <sphereGeometry args={[radiusM * 0.82, 16, 12]} />
        <meshBasicMaterial color={dragging ? '#1d5fb8' : '#2a78d6'} transparent opacity={0.6} />
      </mesh>
      {/* show the height above the ground while lifting a point off the floor */}
      {dragging && !locked && pos.y > 1e-4 && (
        <HeightPill pos={pos} night={night} display={display} />
      )}
    </>
  );
}

/** Length arrow: a cone just past one end pointing outward along the pipe
 * axis. Dragging resizes the pipe along that axis (the opposite end stays put),
 * grid-snapped, with a live length label. */
function LengthArrow({
  movingNodeId,
  movingPos,
  fixedPos,
  odR,
  night,
  display,
}: {
  movingNodeId: string;
  movingPos: Vec3;
  fixedPos: Vec3;
  odR: number;
  night: boolean;
  display: LengthDisplay | undefined;
}) {
  const fixed = useRef<Vec3>(fixedPos);
  const dir = useRef<Vec3>({ x: 1, y: 0, z: 0 });
  // captured at grab: pipe length + the cursor's axis projection, so the
  // outward-offset arrow head doesn't jump the length on the first move
  const grab = useRef<{ startLenM: number; grabProj: number }>({ startLenM: 0, grabProj: 0 });
  // Resize rides the pipe's AXIS LINE, not the y=0 ground — so it works for a
  // vertical (Y) pipe and never inverts at an off-plane view (a ground raycast
  // can't capture motion along Y). Same closest-point-on-axis trick the move
  // gizmo's arrows use.
  const { start, dragging } = useGroundDrag(
    (g) => dragMemberEndLength(movingNodeId, fixed.current, dir.current, g, grab.current),
    {
      project: (ray) =>
        closestAxisPointToRay(
          fixed.current,
          dir.current,
          { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
          { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
        ),
      // same auto-union as a free endpoint drag: reconcile forms an on-body tee
      // when the resized end lands on a run's span (via updateReconciled in
      // dragMemberEndLength), and this welds it onto a coincident node on drop
      onEnd: () => weldDroppedNode(movingNodeId),
    },
  );

  const outward = normalize(sub(movingPos, fixedPos));
  const coneH = Math.max(odR * 3, 0.05);
  const coneR = Math.max(odR * 1.35, 0.018);
  const base = Math.max(odR * 1.7, 0.02) + 0.012 + coneH / 2;
  const center: [number, number, number] = [
    movingPos.x + outward.x * base,
    movingPos.y + outward.y * base,
    movingPos.z + outward.z * base,
  ];
  const segLen = length(sub(movingPos, fixedPos));

  return (
    <group>
      <mesh
        position={center}
        quaternion={orientY(outward)}
        onPointerDown={(e) => {
          fixed.current = fixedPos;
          dir.current = outward;
          // capture the grab's axial position from the SAME axis projection the
          // drag uses, so the first move doesn't jump
          const g = closestAxisPointToRay(
            fixedPos,
            outward,
            { x: e.ray.origin.x, y: e.ray.origin.y, z: e.ray.origin.z },
            { x: e.ray.direction.x, y: e.ray.direction.y, z: e.ray.direction.z },
          );
          grab.current = { startLenM: segLen, grabProj: dot(sub(g, fixedPos), outward) };
          start(e);
        }}
      >
        <coneGeometry args={[coneR, coneH, 18]} />
        <meshBasicMaterial color={dragging ? '#b46a00' : '#e08a00'} />
      </mesh>
      {dragging && (
        <Html position={[center[0], center[1], center[2]]} center zIndexRange={[100, 0]}>
          <div
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              font: "500 12px 'IBM Plex Mono', monospace",
              background: night ? '#1e2128' : '#fff',
              color: night ? '#e8eaf0' : '#1a1d24',
              border: `1px solid ${night ? '#33363f' : '#e4e4e7'}`,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              transform: 'translateY(-16px)',
            }}
          >
            {formatLengthDisplay(segLen, display)}
          </div>
        </Html>
      )}
    </group>
  );
}

/** The centre + extent of the whole selection (all selected members' node +
 * control points), so the move/rotate gizmos operate on the group as one. */
function selectionFrame(
  design: Design,
  ids: string[],
): { memberIds: string[]; centre: Vec3; extent: number } | null {
  const pts: Vec3[] = [];
  const memberIds: string[] = [];
  for (const id of ids) {
    const m = memberById(design, id);
    if (!m) continue;
    memberIds.push(m.id);
    const a = nodeById(design, m.nodeA);
    const b = nodeById(design, m.nodeB);
    if (a) pts.push(easedPos(a.id) ?? a.position);
    if (b) pts.push(easedPos(b.id) ?? b.position);
    if (m.kind === 'formed') for (const cp of m.controlPoints) pts.push(cp);
  }
  if (!memberIds.length || !pts.length) return null;
  const centre = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  centre.x /= pts.length;
  centre.y /= pts.length;
  centre.z /= pts.length;
  const extent = pts.reduce((mx, p) => Math.max(mx, length(sub(p, centre))), 0);
  return { memberIds, centre, extent };
}

// Gizmo colours match the axis triad (X red, Y green, Z blue).
const AXIS_COLORS = { x: '#d64545', y: '#3d9950', z: '#2a78d6' } as const;
const AXIS_DIRS: Record<'x' | 'y' | 'z', Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

/** One translate arrow of the move gizmo: dragging it slides the whole member
 * along `axisKey` (grid-snapped), tracking the cursor's projection onto that
 * world axis so the vertical (Y) arrow works too. */
function MoveArrow({
  memberIds,
  origin,
  axisKey,
  sizeM,
  gridStepM,
  night,
  display,
}: {
  memberIds: string[];
  origin: Vec3;
  axisKey: 'x' | 'y' | 'z';
  sizeM: number;
  gridStepM: number;
  night: boolean;
  display: LengthDisplay | undefined;
}) {
  const axis = AXIS_DIRS[axisKey];
  const originRef = useRef<Vec3>(origin);
  const grabT = useRef(0);
  const lastDelta = useRef(0);
  const rayPoint = (ray: Ray): Vec3 =>
    closestAxisPointToRay(
      originRef.current,
      axis,
      { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
    );
  const { start, dragging } = useGroundDrag(
    (g) => {
      const t = dot(sub(g, originRef.current), axis);
      const raw = t - grabT.current;
      const total = gridStepM > 0 ? Math.round(raw / gridStepM) * gridStepM : raw;
      const inc = total - lastDelta.current;
      if (inc !== 0) {
        translateMembersBy(memberIds, scale(axis, inc));
        lastDelta.current = total;
      }
    },
    { project: rayPoint },
  );

  const shaftLen = sizeM * 0.8;
  const shaftR = Math.max(sizeM * 0.05, 0.004);
  const coneH = sizeM * 0.34;
  const coneR = Math.max(sizeM * 0.16, 0.012);
  const quat = orientY(axis);
  const at = (d: number): [number, number, number] => [
    origin.x + axis.x * d,
    origin.y + axis.y * d,
    origin.z + axis.z * d,
  ];
  const color = AXIS_COLORS[axisKey];
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    originRef.current = origin;
    grabT.current = dot(sub(rayPoint(e.ray), origin), axis);
    lastDelta.current = 0;
    start(e);
  };

  return (
    <group onPointerDown={onDown}>
      <mesh position={at(shaftLen / 2)} quaternion={quat}>
        <cylinderGeometry args={[shaftR, shaftR, shaftLen, 12]} />
        <meshBasicMaterial color={color} opacity={dragging ? 1 : 0.9} transparent />
      </mesh>
      <mesh position={at(shaftLen + coneH / 2)} quaternion={quat}>
        <coneGeometry args={[coneR, coneH, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {/* dragging the vertical arrow shows the selection's height off the ground */}
      {axisKey === 'y' && dragging && <HeightPill pos={origin} night={night} display={display} />}
    </group>
  );
}

/** The move tool's 3-axis translate gizmo, centred on the whole selection. */
export function MoveGizmo() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const gridStepM = useEditorStore((s) => s.snap.gridStepM);
  const night = useThemeStore((s) => s.night);
  if (!design) return null;
  const frame = selectionFrame(design, selectedIds);
  if (!frame) return null;
  const sizeM = Math.max(0.06, Math.min(0.2, Math.max(frame.extent, 0.05)));
  return (
    <group>
      {(['x', 'y', 'z'] as const).map((k) => (
        <MoveArrow
          key={k}
          memberIds={frame.memberIds}
          origin={frame.centre}
          axisKey={k}
          sizeM={sizeM}
          gridStepM={gridStepM}
          night={night}
          display={design.lengthDisplay}
        />
      ))}
    </group>
  );
}

/** The ring plane's reference direction for `axis` (also where the typed-angle
 * input anchors on the ring). Same basis the drag's angle tracking uses. */
function ringPlaneU(axis: Vec3): Vec3 {
  const ref = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(axis, ref));
}

/** One rotate ring of the rotate gizmo: dragging it turns the whole member about
 * `axisKey` through the member's midpoint, tracking the cursor's angle in the
 * ring's plane (so the drag reads as free rotation). A plain CLICK (pointerup
 * within the click slop) opens the typed-angle input for this axis instead. */
function RotateRing({
  memberIds,
  pivot,
  axisKey,
  ringR,
  onTypedOpen,
}: {
  memberIds: string[];
  pivot: Vec3;
  axisKey: 'x' | 'y' | 'z';
  ringR: number;
  onTypedOpen: (axisKey: 'x' | 'y' | 'z') => void;
}) {
  const axis = AXIS_DIRS[axisKey];
  const pivotRef = useRef<Vec3>(pivot);
  const uRef = useRef<Vec3>({ x: 1, y: 0, z: 0 });
  const vRef = useRef<Vec3>({ x: 0, y: 0, z: 1 });
  const lastAngle = useRef(0);
  const angleAt = (g: Vec3): number => {
    const d = sub(g, pivotRef.current);
    return Math.atan2(dot(d, vRef.current), dot(d, uRef.current));
  };
  const { start, dragging } = useGroundDrag(
    (g) => {
      const ang = angleAt(g);
      // shortest signed step since the last frame, applied incrementally
      const delta = Math.atan2(
        Math.sin(ang - lastAngle.current),
        Math.cos(ang - lastAngle.current),
      );
      if (delta !== 0) {
        rotateMembersBy(memberIds, axis, delta, pivotRef.current);
        lastAngle.current = ang;
      }
    },
    { project: (ray) => rayToPlane(ray, pivotRef.current, axis) },
  );
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    pivotRef.current = pivot;
    uRef.current = ringPlaneU(axis);
    vRef.current = cross(axis, uRef.current);
    const g = rayToPlane(e.ray, pivot, axis);
    lastAngle.current = g ? angleAt(g) : 0;
    start(e);
    // Click detection: register AFTER start(e) so on pointerup the drag's own
    // finish (endGesture — a no-move click changes nothing, so no history
    // entry) runs first, THEN a slop-bounded click opens the typed input's
    // fresh gesture.
    const downX = e.nativeEvent.clientX;
    const downY = e.nativeEvent.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > CLICK_SLOP_PX) moved = true;
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cleanup);
    };
    const onUp = () => {
      cleanup();
      if (!moved) onTypedOpen(axisKey);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
  };
  return (
    <mesh position={[pivot.x, pivot.y, pivot.z]} quaternion={orientZ(axis)} onPointerDown={onDown}>
      <torusGeometry args={[ringR, Math.max(ringR * 0.045, 0.004), 8, 48]} />
      <meshBasicMaterial color={AXIS_COLORS[axisKey]} opacity={dragging ? 1 : 0.8} transparent />
    </mesh>
  );
}

/** State of an open typed-angle entry: everything frozen at the ring click so
 * the preview pivot/axis can't drift while the selection rotates. */
interface TypedRotate {
  axisKey: 'x' | 'y' | 'z';
  pivot: Vec3;
  anchor: Vec3;
  memberIds: string[];
  /** the doc as it was when the input opened — restored verbatim on cancel */
  preDoc: Design;
}

/** Typed-angle input for the rotate tool: a ring CLICK opens this small degree
 * field anchored to that ring. Typing live-previews the rotation through the
 * SAME `rotateMembersBy` action a ring drag uses (same pivot/axis basis), all
 * inside one open gesture — Enter commits it as ONE undo entry; Escape, blur,
 * clicking elsewhere, or leaving the tool restores the pre-typed pose exactly
 * (`preDoc`, so `endGesture` sees no change and records nothing). */
function RotateAngleInput({
  axisKey,
  pivot,
  anchor,
  memberIds,
  preDoc,
  night,
  onClose,
}: TypedRotate & { night: boolean; onClose: () => void }) {
  const lastRad = useRef(0);
  const done = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const axis = AXIS_DIRS[axisKey];
  const color = AXIS_COLORS[axisKey];

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    // cancel — or a commit with no net rotation — restores the exact pre-typed
    // doc, so endGesture sees final === gestureStart and records NO entry
    if (!commit || lastRad.current === 0) useAppStore.getState().updateCurrent(() => preDoc);
    useAppStore.getState().endGesture();
    onClose();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // live preview: apply the DELTA from the last previewed angle via the same
  // rotate action a ring drag uses; invalid/empty input previews back to 0°
  const apply = (raw: string) => {
    const deg = Number.parseFloat(raw);
    const rad = Number.isFinite(deg) ? (deg * Math.PI) / 180 : 0;
    const delta = rad - lastRad.current;
    if (delta !== 0) {
      rotateMembersBy(memberIds, axis, delta, pivot);
      lastRad.current = rad;
    }
  };

  // clicking anywhere outside the input reverts-and-closes. Capture phase, so
  // it runs BEFORE a canvas pointer-down (e.g. another ring grab) opens its
  // own gesture on top of this one.
  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      if (boxRef.current && ev.target instanceof Node && boxRef.current.contains(ev.target)) return;
      finishRef.current(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);
  // unmount (tool change / selection cleared) = revert-and-close too
  useEffect(() => () => finishRef.current(false), []);

  return (
    <Html position={[anchor.x, anchor.y, anchor.z]} center zIndexRange={[100, 0]}>
      <div
        ref={boxRef}
        data-viewport-occluder
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          borderRadius: 6,
          font: "500 12px 'IBM Plex Mono', monospace",
          background: night ? '#1e2128' : '#fff',
          color: night ? '#e8eaf0' : '#1a1d24',
          border: `1px solid ${color}`,
          boxShadow: `0 0 0 2px ${color}59`,
          whiteSpace: 'nowrap',
          transform: 'translateY(-16px)',
        }}
      >
        <span style={{ color, fontWeight: 700 }}>{axisKey.toUpperCase()}</span>
        <input
          // biome-ignore lint/a11y/noAutofocus: the input exists to be typed into the moment it opens
          autoFocus
          aria-label="Rotation angle"
          // UNCONTROLLED on purpose: this component renders in the r3f tree,
          // but the <input> lives in drei Html's separate React DOM root — a
          // controlled value= can't flush synchronously across the two roots,
          // so React DOM would keep restoring the stale value between
          // keystrokes. The DOM owns the text; we only parse it on change.
          defaultValue=""
          placeholder="0"
          size={6}
          inputMode="decimal"
          onChange={(e) => apply(e.target.value)}
          onKeyDown={(e) => {
            // never let keystrokes reach the global hotkey handler (tool keys,
            // undo/redo) while the gesture is open
            e.stopPropagation();
            if (e.key === 'Enter') finish(true);
            else if (e.key === 'Escape') finish(false);
          }}
          onBlur={() => finish(false)}
          style={{
            width: 56,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            font: 'inherit',
            color: 'inherit',
          }}
        />
        <span style={{ opacity: 0.7 }}>°</span>
      </div>
    </Html>
  );
}

/** The rotate tool's 3-axis ring gizmo, centred on the whole selection. */
export function RotateGizmo() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const night = useThemeStore((s) => s.night);
  const [typed, setTyped] = useState<TypedRotate | null>(null);
  if (!design) return null;
  const frame = selectionFrame(design, selectedIds);
  if (!frame) return null;
  const ringR = Math.max(0.08, Math.min(0.28, Math.max(frame.extent * 1.1, 0.06)));
  // ring click → freeze pivot/axis (the SAME frame a drag would use) and open
  // the typed input inside a fresh gesture (the click's own drag gesture has
  // already ended empty by the time this runs — see RotateRing.onDown)
  const openTyped = (axisKey: 'x' | 'y' | 'z') => {
    const cur = useAppStore.getState().current;
    if (!cur || typed) return;
    const anchor = add(frame.centre, scale(ringPlaneU(AXIS_DIRS[axisKey]), ringR));
    useAppStore.getState().beginGesture();
    setTyped({ axisKey, pivot: frame.centre, anchor, memberIds: frame.memberIds, preDoc: cur });
  };
  return (
    <group>
      {(['x', 'y', 'z'] as const).map((k) => (
        <RotateRing
          key={k}
          memberIds={frame.memberIds}
          pivot={frame.centre}
          axisKey={k}
          ringR={ringR}
          onTypedOpen={openTyped}
        />
      ))}
      {typed && <RotateAngleInput {...typed} night={night} onClose={() => setTyped(null)} />}
    </group>
  );
}

export function SelectionHandles() {
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const night = useThemeStore((s) => s.night);
  // track eased positions so handles glide with the pipe, not the stepped doc
  useAnim((s) => s.v);
  if (!design) return null;
  // endpoint / length editing is single-member only: a MULTI-select or a whole
  // group selection exposes no per-end handles (you'd be editing a group's guts
  // without entering it). Move/Rotate the group as a unit, or double-click to
  // enter the group and edit its members individually.
  if (selectedIds.length !== 1) return null;
  const member = selectedIds[0] ? memberById(design, selectedIds[0]) : undefined;
  // endpoint move + length editing for BOTH straight and formed pipes (a bent
  // pipe extends by dragging its ends, just like a straight one; its bend shape
  // — the control points — is tweaked separately with the Bend tool)
  if (!member) return null;
  const a = nodeById(design, member.nodeA);
  const b = nodeById(design, member.nodeB);
  if (!a || !b) return null;
  const aPos = easedPos(a.id) ?? a.position;
  const bPos = easedPos(b.id) ?? b.position;
  const odR = pipeSpec(member.size).odM / 2;
  const handleR = Math.max(odR * 1.7, 0.02);
  const display = design.lengthDisplay;
  const locked = design.lengthsLocked;

  return (
    <>
      <MoveHandle
        nodeId={a.id}
        memberId={member.id}
        pos={aPos}
        radiusM={handleR}
        locked={locked}
        night={night}
        display={display}
      />
      <MoveHandle
        nodeId={b.id}
        memberId={member.id}
        pos={bPos}
        radiusM={handleR}
        locked={locked}
        night={night}
        display={display}
      />
      {/* no length editing while locked (drag rotates pivots instead) */}
      {!locked && (
        <>
          <LengthArrow
            movingNodeId={a.id}
            movingPos={aPos}
            fixedPos={bPos}
            odR={odR}
            night={night}
            display={display}
          />
          <LengthArrow
            movingNodeId={b.id}
            movingPos={bPos}
            fixedPos={aPos}
            odR={odR}
            night={night}
            display={display}
          />
        </>
      )}
    </>
  );
}
