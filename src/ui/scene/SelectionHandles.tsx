import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { memberById, nodeById } from '../../design/docOps';
import { length, normalize, sub } from '../../geometry/math3';
import { pipeSpec, type Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { dragMemberEndLength, dragNodeTo } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { formatLength } from '../units';
import { orientY } from './axis';
import { rayToGround } from './ground';

function useDragRig() {
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const begin = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
    if (controls) controls.enabled = false;
    useAppStore.getState().beginGesture();
  };
  const end = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    gl.domElement.releasePointerCapture(e.nativeEvent.pointerId);
    if (controls) controls.enabled = true;
    useAppStore.getState().endGesture();
  };
  return { begin, end };
}

/** Endpoint grab sphere: free move of the junction on the ground, one undo
 * step, OrbitControls suspended. Hold Shift to lock the move to a world axis. */
function MoveHandle({ nodeId, pos, radiusM }: { nodeId: string; pos: Vec3; radiusM: number }) {
  const { begin, end } = useDragRig();
  const [dragging, setDragging] = useState(false);
  const anchor = useRef<Vec3 | null>(null);

  return (
    <mesh
      position={[pos.x, pos.y, pos.z]}
      onPointerDown={(e) => {
        begin(e);
        anchor.current = pos;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        e.stopPropagation();
        const g = rayToGround(e.ray);
        if (g)
          dragNodeTo(nodeId, g, {
            lockAxis: e.nativeEvent.shiftKey,
            anchor: anchor.current ?? undefined,
          });
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        end(e);
        setDragging(false);
        anchor.current = null;
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
  const { begin, end } = useDragRig();
  const [dragging, setDragging] = useState(false);
  const fixed = useRef<Vec3>(fixedPos);
  const dir = useRef<Vec3>({ x: 1, y: 0, z: 0 });

  const outward = normalize(sub(movingPos, fixedPos));
  const gap = radiusGap(odR);
  const coneH = Math.max(odR * 3, 0.05);
  const coneR = Math.max(odR * 1.35, 0.018);
  const base = gap + coneH / 2;
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
          begin(e);
          fixed.current = fixedPos;
          dir.current = outward;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          e.stopPropagation();
          const g = rayToGround(e.ray);
          if (g) dragMemberEndLength(movingNodeId, fixed.current, dir.current, g);
        }}
        onPointerUp={(e) => {
          if (!dragging) return;
          end(e);
          setDragging(false);
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

function radiusGap(odR: number): number {
  return Math.max(odR * 1.7, 0.02) + 0.012;
}

export function SelectionHandles() {
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const night = useThemeStore((s) => s.night);
  if (!design) return null;
  const member = selectedIds[0] ? memberById(design, selectedIds[0]) : undefined;
  if (!member) return null;
  const a = nodeById(design, member.nodeA);
  const b = nodeById(design, member.nodeB);
  if (!a || !b) return null;
  const odR = pipeSpec(member.size).odM / 2;
  const handleR = Math.max(odR * 1.7, 0.02);
  const units = design.unitsPreference;

  return (
    <>
      <MoveHandle nodeId={a.id} pos={a.position} radiusM={handleR} />
      <MoveHandle nodeId={b.id} pos={b.position} radiusM={handleR} />
      <LengthArrow
        movingNodeId={a.id}
        movingPos={a.position}
        fixedPos={b.position}
        odR={odR}
        night={night}
        units={units}
      />
      <LengthArrow
        movingNodeId={b.id}
        movingPos={b.position}
        fixedPos={a.position}
        odR={odR}
        night={night}
        units={units}
      />
    </>
  );
}
