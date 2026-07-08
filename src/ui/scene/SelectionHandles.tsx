import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { type Ray, Raycaster, Vector2, Vector3 } from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { closestAxisPointToRay } from '../../design/dragMath';
import { cross, dot, length, normalize, scale, sub } from '../../geometry/math3';
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
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formatLengthDisplay } from '../units';
import { orientY, orientZ } from './axis';
import { dominantAxisNormal, rayToGround, rayToPlane } from './ground';

/**
 * A ground-plane drag driven by WINDOW pointer listeners, not the handle
 * mesh's own events. This is deliberate: r3f only sends a mesh pointermove/up
 * while the ray intersects it, so a mesh-driven drag would stop — and its
 * "re-enable OrbitControls" pointerup would never fire — the moment the cursor
 * left the small handle, leaving the camera stuck. Listening on window keeps
 * the drag alive anywhere and guarantees the pointerup runs. OrbitControls is
 * suspended for the duration (no setPointerCapture, so nothing fights it).
 */
function useGroundDrag(
  onMove: (point: Vec3, ev: PointerEvent) => void,
  opts?: {
    // when it returns a point, the drag rides a view-facing plane through that
    // point (Blender-style) instead of the y = 0 ground — so a floating node
    // isn't dragged down to the floor
    viewPlaneOrigin?: () => Vec3 | null;
    // a fully custom projection of the picking ray to a world point, captured
    // at grab time (used by the move-tool axis arrows: closest point on the axis
    // to the ray, which the vertical axis needs — a ground raycast can't give
    // it). Takes precedence over viewPlaneOrigin / ground.
    project?: (ray: Ray) => Vec3 | null;
  },
) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const [dragging, setDragging] = useState(false);
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const fwd = useMemo(() => new Vector3(), []);

  const start = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); // keep the ground plane from also handling this pointer
    if (controls) controls.enabled = false;
    useAppStore.getState().beginGesture();
    setDragging(true);
    const el = gl.domElement;

    // fix the projection at grab time
    const project = opts?.project ?? null;
    const origin = project ? null : (opts?.viewPlaneOrigin?.() ?? null);
    let plane: { point: Vec3; normal: Vec3 } | null = null;
    if (origin) {
      camera.getWorldDirection(fwd);
      plane = { point: origin, normal: dominantAxisNormal({ x: fwd.x, y: fwd.y, z: fwd.z }) };
    }

    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      const g = project
        ? project(rc.ray)
        : plane
          ? rayToPlane(rc.ray, plane.point, plane.normal)
          : rayToGround(rc.ray);
      if (g) onMove(g, ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (controls) controls.enabled = true;
      useAppStore.getState().endGesture();
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return { start, dragging };
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
}: {
  nodeId: string;
  memberId: string;
  pos: Vec3;
  radiusM: number;
  locked: boolean;
}) {
  const anchor = useRef<Vec3 | null>(null);
  const dragId = useRef<string>(nodeId);
  const pendingDetach = useRef(false);
  const { start, dragging } = useGroundDrag(
    (g, ev) => {
      // detach on the first move frame, so it's inside the drag's single gesture
      if (pendingDetach.current) {
        dragId.current = detachMemberEnd(memberId, nodeId) ?? nodeId;
        pendingDetach.current = false;
      }
      const id = dragId.current;
      return locked
        ? dragLocked(id, g)
        : dragNodeTo(id, g, { lockAxis: ev.shiftKey, anchor: anchor.current ?? undefined });
    },
    // free move rides a view-facing plane through the node so a floating node
    // keeps its height; locked-mode IK stays on the ground plane
    { viewPlaneOrigin: () => (locked ? null : pos) },
  );
  return (
    <mesh
      position={[pos.x, pos.y, pos.z]}
      onPointerDown={(e) => {
        anchor.current = pos;
        dragId.current = nodeId;
        pendingDetach.current = !locked && e.nativeEvent.ctrlKey;
        start(e);
      }}
    >
      {/* slightly smaller than the hit radius + partially transparent */}
      <sphereGeometry args={[radiusM * 0.82, 16, 12]} />
      <meshBasicMaterial color={dragging ? '#1d5fb8' : '#2a78d6'} transparent opacity={0.6} />
    </mesh>
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
  const { start, dragging } = useGroundDrag((g) =>
    dragMemberEndLength(movingNodeId, fixed.current, dir.current, g, grab.current),
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
          const g = rayToGround(e.ray);
          grab.current = {
            startLenM: segLen,
            grabProj: g ? dot(sub(g, fixedPos), outward) : segLen,
          };
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
}: {
  memberIds: string[];
  origin: Vec3;
  axisKey: 'x' | 'y' | 'z';
  sizeM: number;
  gridStepM: number;
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
    </group>
  );
}

/** The move tool's 3-axis translate gizmo, centred on the whole selection. */
export function MoveGizmo() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const gridStepM = useEditorStore((s) => s.snap.gridStepM);
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
        />
      ))}
    </group>
  );
}

/** One rotate ring of the rotate gizmo: dragging it turns the whole member about
 * `axisKey` through the member's midpoint, tracking the cursor's angle in the
 * ring's plane (so the drag reads as free rotation). */
function RotateRing({
  memberIds,
  pivot,
  axisKey,
  ringR,
}: {
  memberIds: string[];
  pivot: Vec3;
  axisKey: 'x' | 'y' | 'z';
  ringR: number;
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
    const ref = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    uRef.current = normalize(cross(axis, ref));
    vRef.current = cross(axis, uRef.current);
    const g = rayToPlane(e.ray, pivot, axis);
    lastAngle.current = g ? angleAt(g) : 0;
    start(e);
  };
  return (
    <mesh position={[pivot.x, pivot.y, pivot.z]} quaternion={orientZ(axis)} onPointerDown={onDown}>
      <torusGeometry args={[ringR, Math.max(ringR * 0.045, 0.004), 8, 48]} />
      <meshBasicMaterial color={AXIS_COLORS[axisKey]} opacity={dragging ? 1 : 0.8} transparent />
    </mesh>
  );
}

/** The rotate tool's 3-axis ring gizmo, centred on the whole selection. */
export function RotateGizmo() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  if (!design) return null;
  const frame = selectionFrame(design, selectedIds);
  if (!frame) return null;
  const ringR = Math.max(0.08, Math.min(0.28, Math.max(frame.extent * 1.1, 0.06)));
  return (
    <group>
      {(['x', 'y', 'z'] as const).map((k) => (
        <RotateRing
          key={k}
          memberIds={frame.memberIds}
          pivot={frame.centre}
          axisKey={k}
          ringR={ringR}
        />
      ))}
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
  const member = selectedIds[0] ? memberById(design, selectedIds[0]) : undefined;
  // length arrows + endpoint drag apply to straight pipe only (formed pipes are
  // edited by their control points, a later slice)
  if (member?.kind !== 'straight') return null;
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
      <MoveHandle nodeId={a.id} memberId={member.id} pos={aPos} radiusM={handleR} locked={locked} />
      <MoveHandle nodeId={b.id} memberId={member.id} pos={bPos} radiusM={handleR} locked={locked} />
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
