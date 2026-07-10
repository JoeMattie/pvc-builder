// Renders formed (heat-bent) pipe as a smooth swept tube along a Catmull-Rom
// spline through nodeA → control points → nodeB (planfile §6), at true OD.
// Endpoints use eased render positions so the tube glides with the design.
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { CatmullRomCurve3, Raycaster, Vector2, Vector3 } from 'three';
import { nodeById } from '../../design/docOps';
import { analyzeFormed } from '../../design/formed';
import { add, dot, scale, sub } from '../../geometry/math3';
import { type FormedMember, pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import {
  addFormedControlPoint,
  bendMemberAt,
  moveFormedControlPoint,
  selectMember,
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { dominantAxisNormal, rayToPlane } from './ground';
import { GROUP_DIM_ALPHA } from './instancing';

const toV3 = (p: Vec3) => new Vector3(p.x, p.y, p.z);
const CLICK_SLOP_PX = 6; // press-move below this reads as a click, not a bend drag

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

/** The swept tube for one formed pipe, with the Bend tool's press-drag: dragging
 * the tube RE-BENDS it (a fresh bend, length-locked when the toggle is on — the
 * developed/cut length is conserved); a click (no drag) adds a control point.
 * In select/move/rotate a click selects it (like a straight pipe). */
function FormedTube({
  member,
  curve,
  r,
  segs,
  isSel,
  dimmed,
  color,
  tool,
  onSelect,
  at,
}: {
  member: FormedMember;
  curve: CatmullRomCurve3;
  r: number;
  segs: number;
  isSel: boolean;
  dimmed: boolean;
  color: string;
  tool: string;
  onSelect: ((id: string) => void) | undefined;
  at: (id: string) => Vec3 | undefined;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const fwd = useMemo(() => new Vector3(), []);

  const startBend = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return;
    const design = useAppStore.getState().current;
    const m = design?.members.find((x) => x.id === member.id);
    if (m?.kind !== 'formed') return;
    const a = at(m.nodeA);
    const b = at(m.nodeB);
    if (!a || !b) return;
    e.stopPropagation();
    const axis = sub(b, a);
    const len2 = dot(axis, axis);
    const clickPoint = { x: e.point.x, y: e.point.y, z: e.point.z };
    const t = len2 > 1e-9 ? Math.max(0, Math.min(1, dot(sub(clickPoint, a), axis) / len2)) : 0.5;
    const grab = add(a, scale(axis, t));
    const axisLen = Math.sqrt(len2);
    // re-bend conserves the current DEVELOPED (cut) length when lock-length is on
    const dev = analyzeFormed(design!, m)?.developedLengthM ?? axisLen;
    const lengthRef =
      axisLen > 1e-6 ? { axisDir: scale(axis, 1 / axisLen), lengthM: dev } : undefined;
    camera.getWorldDirection(fwd);
    const normal = dominantAxisNormal({ x: fwd.x, y: fwd.y, z: fwd.z });
    const sx = e.nativeEvent.clientX;
    const sy = e.nativeEvent.clientY;
    let bent = false;
    if (controls) controls.enabled = false;
    useAppStore.getState().beginGesture();
    const el = gl.domElement;
    const move = (ev: PointerEvent) => {
      if (!bent && Math.hypot(ev.clientX - sx, ev.clientY - sy) <= CLICK_SLOP_PX) return;
      bent = true;
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      const cur = rayToPlane(rc.ray, grab, normal);
      if (cur) bendMemberAt(member.id, t, sub(cur, grab), lengthRef);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (controls) controls.enabled = true;
      if (!bent) addFormedControlPoint(member.id, clickPoint); // a click adds a point
      useAppStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const inBend = tool === 'bend';
  // outside an entered group the tube GHOSTS (semi-transparent, colour kept —
  // matching the instanced pipes) and is inert
  const click =
    !inBend && !dimmed && onSelect
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(member.id);
        }
      : undefined;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node
    <mesh
      onClick={click}
      onPointerDown={inBend && !dimmed ? startBend : undefined}
      castShadow
      receiveShadow
    >
      <tubeGeometry args={[curve, segs, r, 14, false]} />
      <meshPhysicalMaterial
        // key: remount the material when the dim flag flips — three bakes an
        // OPAQUE define (alpha forced to 1) into non-transparent programs
        key={dimmed ? 'dim' : 'solid'}
        color={color}
        roughness={0.38}
        metalness={0}
        clearcoat={0.6}
        clearcoatRoughness={0.35}
        transparent={dimmed}
        opacity={dimmed ? GROUP_DIM_ALPHA : 1}
        emissive={(isSel || inBend) && !dimmed ? '#2a78d6' : '#000000'}
        emissiveIntensity={dimmed ? 0 : isSel ? 0.35 : inBend ? 0.12 : 0}
      />
    </mesh>
  );
}

export function FormedLayer() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const enteredGroupId = useEditorStore((s) => s.enteredGroupId);
  const night = useThemeStore((s) => s.night);
  if (!design) return null;
  const formed = design.members.filter((m): m is FormedMember => m.kind === 'formed');
  if (!formed.length) return null;

  const color = scenePalette(night).pvc;
  const selected = new Set(selectedIds);
  // when a group is entered, formed pipes outside it ghost like straight pipes
  const enteredGroup = enteredGroupId
    ? design.groups.find((gr) => gr.id === enteredGroupId)
    : undefined;
  const activeSet = enteredGroup ? new Set(enteredGroup.memberIds) : null;
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
        return (
          <group key={m.id}>
            <FormedTube
              member={m}
              curve={curve}
              r={r}
              segs={segs}
              isSel={selected.has(m.id)}
              dimmed={!!activeSet && !activeSet.has(m.id)}
              color={color}
              tool={tool}
              onSelect={onSelect}
              at={at}
            />
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
