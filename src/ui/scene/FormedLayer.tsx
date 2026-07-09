// Renders formed (heat-bent) pipe as a smooth swept tube along a Catmull-Rom
// spline through nodeA → control points → nodeB (planfile §6), at true OD.
// Endpoints use eased render positions so the tube glides with the design.
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { CatmullRomCurve3, Raycaster, Vector2, Vector3 } from 'three';
import { nodeById } from '../../design/docOps';
import { type FormedMember, pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import {
  addFormedControlPoint,
  moveFormedControlPoint,
  selectMember,
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { dominantAxisNormal, rayToPlane } from './ground';

const toV3 = (p: Vec3) => new Vector3(p.x, p.y, p.z);

/** A draggable control-point handle on a formed pipe (Bend tool). Dragging it
 * rides a view-facing plane through the point, so the bend follows the cursor.
 * Window listeners keep the drag alive off the tiny handle. */
function ControlHandle({ memberId, index, pos }: { memberId: string; index: number; pos: Vec3 }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const fwd = useMemo(() => new Vector3(), []);

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return;
    e.stopPropagation();
    camera.getWorldDirection(fwd);
    const normal = dominantAxisNormal({ x: fwd.x, y: fwd.y, z: fwd.z });
    if (controls) controls.enabled = false;
    useAppStore.getState().beginGesture();
    const el = gl.domElement;
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      const g = rayToPlane(rc.ray, pos, normal);
      if (g) moveFormedControlPoint(memberId, index, g);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (controls) controls.enabled = true;
      useAppStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <mesh position={[pos.x, pos.y, pos.z]} onPointerDown={onDown}>
      <sphereGeometry args={[0.016, 14, 12]} />
      <meshBasicMaterial color="#e08a00" transparent opacity={0.85} />
    </mesh>
  );
}

/** Catmull-Rom curve through a formed member's eased points, or null. */
export function formedCurve(
  member: FormedMember,
  at: (id: string) => Vec3 | undefined,
): CatmullRomCurve3 | null {
  const a = at(member.nodeA);
  const b = at(member.nodeB);
  if (!a || !b) return null;
  const pts = [a, ...member.controlPoints, b].map(toV3);
  return new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

export function FormedLayer() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const night = useThemeStore((s) => s.night);
  if (!design) return null;
  const formed = design.members.filter((m): m is FormedMember => m.kind === 'formed');
  if (!formed.length) return null;

  const color = scenePalette(night).pvc;
  const selected = new Set(selectedIds);
  // click-select in the same tools straight pipes allow (select / move / rotate)
  const onSelect =
    tool === 'select' || tool === 'move' || tool === 'rotate' ? selectMember : undefined;
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;
  // the Bend tool shows draggable control-point handles so bends can be tweaked
  const showHandles = tool === 'bend';

  return (
    <>
      {formed.map((m) => {
        const curve = formedCurve(m, at);
        if (!curve) return null;
        const r = pipeSpec(m.size).odM / 2;
        const segs = Math.max(24, (m.controlPoints.length + 1) * 20);
        const isSel = selected.has(m.id);
        // select on click (select/move/rotate); in the Bend tool, clicking the
        // tube instead ADDS a control point where you clicked
        const click =
          tool === 'bend'
            ? (e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                addFormedControlPoint(m.id, { x: e.point.x, y: e.point.y, z: e.point.z });
              }
            : onSelect
              ? (e: ThreeEvent<MouseEvent>) => {
                  e.stopPropagation();
                  onSelect(m.id);
                }
              : undefined;
        return (
          <group key={m.id}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node */}
            <mesh onClick={click} castShadow receiveShadow>
              <tubeGeometry args={[curve, segs, r, 14, false]} />
              <meshPhysicalMaterial
                color={color}
                roughness={0.38}
                metalness={0}
                clearcoat={0.6}
                clearcoatRoughness={0.35}
                emissive={isSel || showHandles ? '#2a78d6' : '#000000'}
                emissiveIntensity={isSel ? 0.35 : showHandles ? 0.12 : 0}
              />
            </mesh>
            {showHandles &&
              m.controlPoints.map((cp, i) => (
                <ControlHandle
                  // biome-ignore lint/suspicious/noArrayIndexKey: index IS the control-point identity
                  key={i}
                  memberId={m.id}
                  index={i}
                  pos={cp}
                />
              ))}
          </group>
        );
      })}
    </>
  );
}
