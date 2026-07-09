// Extend (push) tool gizmos: for each pipe END, semi-transparent stub cylinders
// in every direction you can push a new pipe (the 6 world axes + continuations
// opposite incident pipes, minus any that would protrude into a pipe — see
// design/extend). Clicking a stub starts an axis-locked draw out of that end.
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { Raycaster, Vector2 } from 'three';
import { memberById } from '../../design/docOps';
import { closestAxisPointToRay } from '../../design/dragMath';
import { endSizeAt, extendDirections } from '../../design/extend';
import { pipeSpec } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { placeDrawPoint, startExtend } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { orientY } from './axis';
import { CLICK_SLOP_PX, startWindowPointerDrag } from './interactions';

/** Above this node count, only the SELECTED members' ends get gizmos (a whole
 * dense model of stubs would be unusable); pick a pipe first, then push its ends. */
const NODE_CAP = 60;
/** Stub length: ~1 inch out from the end surface. */
const STUB_LEN_M = 0.0254;
const STUB_COLOR = '#2a78d6';

export function ExtendLayer() {
  const tool = useEditorStore((s) => s.tool);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  useAnim((s) => s.v); // glide the gizmos with eased positions
  const [hover, setHover] = useState<string | null>(null);

  // eligible ends: every node on a small model, else the selected members' ends
  const nodeIds = useMemo(() => {
    if (!design) return [];
    if (design.nodes.length <= NODE_CAP) return design.nodes.map((n) => n.id);
    const set = new Set<string>();
    for (const id of selectedIds) {
      const m = memberById(design, id);
      if (m) {
        set.add(m.nodeA);
        set.add(m.nodeB);
      }
    }
    return [...set];
  }, [design, selectedIds]);

  if (tool !== 'extend' || !design) return null;

  return (
    <group>
      {nodeIds.map((nodeId) => {
        const origin = easedPos(nodeId) ?? design.nodes.find((n) => n.id === nodeId)?.position;
        const size = endSizeAt(design, nodeId);
        if (!origin || !size) return null;
        const odR = pipeSpec(size).odM / 2;
        const stubR = odR * 0.6; // 60% of the pipe DIAMETER → 0.6·radius each side
        const startGap = odR * 0.4;
        const dirs = extendDirections(design, nodeId);
        return dirs.map((dir, i) => {
          const key = `${nodeId}:${i}`;
          const center: [number, number, number] = [
            origin.x + dir.x * (startGap + STUB_LEN_M / 2),
            origin.y + dir.y * (startGap + STUB_LEN_M / 2),
            origin.z + dir.z * (startGap + STUB_LEN_M / 2),
          ];
          const hot = hover === key;
          return (
            <mesh
              key={key}
              position={center}
              quaternion={orientY(dir)}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHover(key);
              }}
              onPointerOut={() => setHover((h) => (h === key ? null : h))}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                if (e.nativeEvent.button !== 0) return;
                e.stopPropagation();
                const startX = e.nativeEvent.clientX;
                const startY = e.nativeEvent.clientY;
                startExtend(nodeId, dir);
                const pointFromClient = (clientX: number, clientY: number) => {
                  const rect = gl.domElement.getBoundingClientRect();
                  ndc.set(
                    ((clientX - rect.left) / rect.width) * 2 - 1,
                    -((clientY - rect.top) / rect.height) * 2 + 1,
                  );
                  rc.setFromCamera(ndc, camera);
                  const p = closestAxisPointToRay(
                    origin,
                    dir,
                    { x: rc.ray.origin.x, y: rc.ray.origin.y, z: rc.ray.origin.z },
                    { x: rc.ray.direction.x, y: rc.ray.direction.y, z: rc.ray.direction.z },
                  );
                  return p;
                };
                const up = (ev: PointerEvent) => {
                  if (ev.button !== 0) return;
                  // a click (no drag) leaves the path open for a second click /
                  // typed length; a drag places the point where it was released
                  if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= CLICK_SLOP_PX) return;
                  placeDrawPoint(pointFromClient(ev.clientX, ev.clientY));
                };
                // preview tracking during the drag comes from the DrawController's
                // ground-plane pointermove (no pointer capture is taken), so only
                // the release needs handling here
                startWindowPointerDrag({ onMove: () => {}, onUp: up, onCancel: up });
              }}
            >
              <cylinderGeometry args={[stubR, stubR, STUB_LEN_M, 16]} />
              <meshBasicMaterial
                color={STUB_COLOR}
                transparent
                opacity={hot ? 0.75 : 0.32}
                depthWrite={false}
              />
            </mesh>
          );
        });
      })}
    </group>
  );
}
