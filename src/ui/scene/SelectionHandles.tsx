import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useState } from 'react';
import { memberById, nodeById } from '../../design/docOps';
import { pipeSpec, type Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { dragNodeTo } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { rayToGround } from './ground';

/** A grabbable sphere at a node endpoint. Dragging moves the node (snapping to
 * other geometry) as one undo step, with OrbitControls suspended so the drag
 * doesn't also orbit the camera. */
function Handle({ nodeId, pos, radiusM }: { nodeId: string; pos: Vec3; radiusM: number }) {
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const [dragging, setDragging] = useState(false);

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
    setDragging(true);
    if (controls) controls.enabled = false;
    useAppStore.getState().beginGesture();
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    e.stopPropagation();
    const g = rayToGround(e.ray);
    if (g) dragNodeTo(nodeId, g);
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    e.stopPropagation();
    gl.domElement.releasePointerCapture(e.nativeEvent.pointerId);
    setDragging(false);
    if (controls) controls.enabled = true;
    useAppStore.getState().endGesture();
  };

  return (
    <mesh
      position={[pos.x, pos.y, pos.z]}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <sphereGeometry args={[radiusM, 16, 12]} />
      <meshBasicMaterial color={dragging ? '#1d5fb8' : '#2a78d6'} />
    </mesh>
  );
}

export function SelectionHandles() {
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  if (!design) return null;
  const member = selectedIds[0] ? memberById(design, selectedIds[0]) : undefined;
  if (!member) return null;
  const a = nodeById(design, member.nodeA);
  const b = nodeById(design, member.nodeB);
  if (!a || !b) return null;
  const r = Math.max(pipeSpec(member.size).odM / 2, 0.012) * 1.5;
  return (
    <>
      <Handle nodeId={a.id} pos={a.position} radiusM={r} />
      <Handle nodeId={b.id} pos={b.position} radiusM={r} />
    </>
  );
}
