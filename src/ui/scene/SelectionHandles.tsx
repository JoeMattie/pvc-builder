import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Raycaster, Vector2 } from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { length, normalize, sub } from '../../geometry/math3';
import { pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { dragLocked, dragMemberEndLength, dragNodeTo } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formatLength } from '../units';
import { orientY } from './axis';
import { rayToGround } from './ground';

/**
 * A ground-plane drag driven by WINDOW pointer listeners, not the handle
 * mesh's own events. This is deliberate: r3f only sends a mesh pointermove/up
 * while the ray intersects it, so a mesh-driven drag would stop — and its
 * "re-enable OrbitControls" pointerup would never fire — the moment the cursor
 * left the small handle, leaving the camera stuck. Listening on window keeps
 * the drag alive anywhere and guarantees the pointerup runs. OrbitControls is
 * suspended for the duration (no setPointerCapture, so nothing fights it).
 */
function useGroundDrag(onMove: (ground: Vec3, ev: PointerEvent) => void) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const [dragging, setDragging] = useState(false);
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);

  const start = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); // keep the ground plane from also handling this pointer
    if (controls) controls.enabled = false;
    useAppStore.getState().beginGesture();
    setDragging(true);
    const el = gl.domElement;

    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      const g = rayToGround(rc.ray);
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
 * step. Hold Shift to lock the move to a world axis. When lengths are locked,
 * the drag runs pivot IK instead (drag-to-rotate). */
function MoveHandle({
  nodeId,
  pos,
  radiusM,
  locked,
}: {
  nodeId: string;
  pos: Vec3;
  radiusM: number;
  locked: boolean;
}) {
  const anchor = useRef<Vec3 | null>(null);
  const { start, dragging } = useGroundDrag((g, ev) =>
    locked
      ? dragLocked(nodeId, g)
      : dragNodeTo(nodeId, g, { lockAxis: ev.shiftKey, anchor: anchor.current ?? undefined }),
  );
  return (
    <mesh
      position={[pos.x, pos.y, pos.z]}
      onPointerDown={(e) => {
        anchor.current = pos;
        start(e);
      }}
    >
      <sphereGeometry args={[radiusM, 16, 12]} />
      <meshBasicMaterial color={dragging ? '#1d5fb8' : '#2a78d6'} />
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
  units,
}: {
  movingNodeId: string;
  movingPos: Vec3;
  fixedPos: Vec3;
  odR: number;
  night: boolean;
  units: 'imperial' | 'metric';
}) {
  const fixed = useRef<Vec3>(fixedPos);
  const dir = useRef<Vec3>({ x: 1, y: 0, z: 0 });
  const { start, dragging } = useGroundDrag((g) =>
    dragMemberEndLength(movingNodeId, fixed.current, dir.current, g),
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
            {formatLength(segLen, units)}
          </div>
        </Html>
      )}
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
  const units = design.unitsPreference;
  const locked = design.lengthsLocked;

  return (
    <>
      <MoveHandle nodeId={a.id} pos={aPos} radiusM={handleR} locked={locked} />
      <MoveHandle nodeId={b.id} pos={bPos} radiusM={handleR} locked={locked} />
      {/* no length editing while locked (drag rotates pivots instead) */}
      {!locked && (
        <>
          <LengthArrow
            movingNodeId={a.id}
            movingPos={aPos}
            fixedPos={bPos}
            odR={odR}
            night={night}
            units={units}
          />
          <LengthArrow
            movingNodeId={b.id}
            movingPos={bPos}
            fixedPos={aPos}
            odR={odR}
            night={night}
            units={units}
          />
        </>
      )}
    </>
  );
}
