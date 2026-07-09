// r3f renderer for the pipe model: PBR cylinders at true OD with a faint
// clearcoat so white PVC reads as plastic (planfile §6), plus a hollow bore at
// each free pipe end so pipes read as real tube with wall thickness. In the
// select tool, clicking a pipe selects its member.
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Raycaster, Vector2, Vector3 } from 'three';
import { endCapAllowanceM } from '../../design/bom';
import { incidentMembers, memberById, nodeById } from '../../design/docOps';
import { add, dot, length, normalize, scale, sub } from '../../geometry/math3';
import { pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { bendMemberAt, placeDrawPoint, selectMember } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { orientZ, placeAxis } from './axis';
import { dominantAxisNormal, rayToPlane } from './ground';
import { buildPipeModel, type PipeCylinder, type PipeEnd } from './pipeModel';

const RADIAL_SEGMENTS = 20;

function Pipe({
  cyl,
  color,
  selected,
  onSelect,
  onContext,
  onDouble,
  onBend,
}: {
  cyl: PipeCylinder;
  color: string;
  selected: boolean;
  onSelect?: (memberId: string) => void;
  onContext?: (memberId: string, e: ThreeEvent<MouseEvent>) => void;
  onDouble?: (e: ThreeEvent<MouseEvent>) => void;
  onBend?: (memberId: string, e: ThreeEvent<PointerEvent>) => void;
}) {
  const placed = placeAxis(cyl.a, cyl.b);
  if (!placed) return null;
  const click = onSelect
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(cyl.memberId);
      }
    : undefined;
  const bendDown = onBend ? (e: ThreeEvent<PointerEvent>) => onBend(cyl.memberId, e) : undefined;
  const context = onContext
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onContext(cyl.memberId, e);
      }
    : undefined;
  const dbl = onDouble
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onDouble(e);
      }
    : undefined;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a three.js scene node, not a DOM element — the a11y rule does not apply
    <mesh
      position={placed.mid}
      quaternion={placed.quat}
      onClick={click}
      onContextMenu={context}
      onDoubleClick={dbl}
      onPointerDown={bendDown}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[cyl.radiusM, cyl.radiusM, placed.len, RADIAL_SEGMENTS]} />
      <meshPhysicalMaterial
        color={color}
        roughness={0.38}
        metalness={0}
        clearcoat={0.6}
        clearcoatRoughness={0.35}
        emissive={selected ? '#2a78d6' : '#000000'}
        emissiveIntensity={selected ? 0.35 : 0}
      />
    </mesh>
  );
}

/** Renders the current design's pipe. Subscribes to the document itself (not
 * via Scene) so drags only re-render this layer, not the whole scene. */
export function PipeLayer() {
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const drawingFrom = useEditorStore((s) => s.drawingFromNodeId);
  const night = useThemeStore((s) => s.night);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const fwd = useMemo(() => new Vector3(), []);
  // re-render while geometry is easing toward its snapped target (reads the
  // mutable eased-position map, so it recomputes each animating frame)
  useAnim((s) => s.v);
  const color = scenePalette(night).pvc;
  const model = design ? buildPipeModel(design, easedPos) : null;
  if (!model || !design) return null;
  // click-to-select works in the select / move / rotate tools (so you can pick
  // the pipe to transform without leaving the gizmo)
  const editing = tool === 'select' || tool === 'move' || tool === 'rotate';
  const onSelect = editing ? selectMember : undefined;
  // right-click routing: a shared JUNCTION (where ≥2 pipes meet, within the end
  // zone) opens the join selector; anywhere else on the pipe body — or a lone
  // flat end — opens the size switcher for that pipe (or the whole multi-select).
  const onContext =
    editing && design && !drawingFrom
      ? (memberId: string, e: ThreeEvent<MouseEvent>) => {
          const ne = e.nativeEvent as MouseEvent;
          const store = useEditorStore.getState();
          const m = memberById(design, memberId);
          if (m?.kind === 'straight') {
            const pa = nodeById(design, m.nodeA)?.position;
            const pb = nodeById(design, m.nodeB)?.position;
            if (pa && pb) {
              const nearA = length(sub(e.point, pa)) <= length(sub(e.point, pb));
              const nodeId = nearA ? m.nodeA : m.nodeB;
              const endPos = nearA ? pa : pb;
              const endZone = 0.25 * length(sub(pa, pb));
              // only a genuine multi-pipe junction opens the join menu
              if (
                length(sub(e.point, endPos)) < endZone &&
                incidentMembers(design, nodeId).length >= 2
              ) {
                store.openJoinMenu({ nodeId, moverId: memberId, x: ne.clientX, y: ne.clientY });
                return;
              }
            }
          }
          // resize the whole current multi-selection if this pipe is part of it
          const sel = store.selectedIds;
          const memberIds = sel.includes(memberId) && sel.length > 1 ? sel : [memberId];
          store.openSizeMenu({ memberIds, x: ne.clientX, y: ne.clientY });
        }
      : undefined;
  // Bend tool: press+drag a pipe to bend it. The grab parameter t comes from the
  // click point along the pipe; the drag rides a view-facing plane through the
  // grab so the bend follows the cursor. Window listeners keep the drag alive off
  // the mesh (same reason as the endpoint handles).
  const onBend =
    tool === 'bend' && design
      ? (memberId: string, e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return;
          const m = memberById(design, memberId);
          if (!m) return;
          const a = easedPos(m.nodeA) ?? nodeById(design, m.nodeA)?.position;
          const b = easedPos(m.nodeB) ?? nodeById(design, m.nodeB)?.position;
          if (!a || !b) return;
          e.stopPropagation();
          const axis = sub(b, a);
          const len2 = dot(axis, axis);
          const gp = { x: e.point.x, y: e.point.y, z: e.point.z };
          const t = len2 > 1e-9 ? Math.max(0, Math.min(1, dot(sub(gp, a), axis) / len2)) : 0.5;
          const grab = add(a, scale(axis, t));
          // frozen reference for length-lock (nodeB moves each frame, so the
          // axis + material length must be captured ONCE, here at gesture start)
          const axisLen = Math.sqrt(len2);
          const lengthRef =
            axisLen > 1e-6 ? { axisDir: scale(axis, 1 / axisLen), lengthM: axisLen } : undefined;
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
            const cur = rayToPlane(rc.ray, grab, normal);
            if (cur) bendMemberAt(memberId, t, sub(cur, grab), lengthRef);
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
        }
      : undefined;

  // double-click a pipe (in the select tool) → start drawing a new pipe from the
  // clicked point (snaps on-pipe → a tee / branch start)
  const onDouble =
    tool === 'select' && !drawingFrom
      ? (e: ThreeEvent<MouseEvent>) => {
          useEditorStore.getState().setTool('draw');
          placeDrawPoint(e.point);
        }
      : undefined;
  const selected = new Set(selectedIds);

  // GHOST end-cap extensions (BOM: a pipe whose END receives a wrap is cut 1" +
  // 1 radius longer for an end cap) — shown translucent, real geometry unchanged
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;
  const ghostCaps = design.joints.flatMap((j) => {
    if (j.mode !== 'wrapped') return [];
    const recv = memberById(design, j.receiver);
    if (recv?.kind !== 'straight' || (recv.nodeA !== j.nodeId && recv.nodeB !== j.nodeId))
      return [];
    const endPos = at(j.nodeId);
    const otherPos = at(recv.nodeA === j.nodeId ? recv.nodeB : recv.nodeA);
    if (!endPos || !otherPos) return [];
    const d = sub(endPos, otherPos);
    if (length(d) < 1e-9) return [];
    const dir = normalize(d);
    return [
      {
        id: `${j.id}-cap`,
        a: endPos,
        b: add(endPos, scale(dir, endCapAllowanceM(recv.size))),
        r: pipeSpec(recv.size).odM / 2,
      },
    ];
  });

  return (
    <>
      {model.cylinders.map((c) => (
        <Pipe
          key={c.memberId}
          cyl={c}
          color={color}
          selected={selected.has(c.memberId)}
          onSelect={onSelect}
          onContext={onContext}
          onDouble={onDouble}
          onBend={onBend}
        />
      ))}
      {model.ends.map((e) => (
        <Bore key={e.nodeId} end={e} night={night} />
      ))}
      {ghostCaps.map((c) => (
        <GhostCap key={c.id} a={c.a} b={c.b} r={c.r} />
      ))}
    </>
  );
}

/** A translucent extension past a pipe end — the end-cap allowance ghost. */
function GhostCap({ a, b, r }: { a: Vec3; b: Vec3; r: number }) {
  const placed = placeAxis(a, b);
  if (!placed) return null;
  return (
    <mesh position={placed.mid} quaternion={placed.quat}>
      <cylinderGeometry args={[r, r, placed.len, RADIAL_SEGMENTS]} />
      <meshBasicMaterial color="#2a78d6" transparent opacity={0.22} />
    </mesh>
  );
}

/** A hollow pipe end: a recessed dark bore disc inside the pipe's rim, so the
 * open end reads as tube with wall thickness (OD rim − bore = the wall). */
function Bore({ end, night }: { end: PipeEnd; night: boolean }) {
  const inner = Math.max(end.odM / 2 - end.wallM, 0.001);
  const quat = orientZ(end.dir);
  // sit the bore just outside the end face so it isn't hidden by the cylinder cap
  const c: [number, number, number] = [
    end.center.x + end.dir.x * 0.0004,
    end.center.y + end.dir.y * 0.0004,
    end.center.z + end.dir.z * 0.0004,
  ];
  return (
    <mesh position={c} quaternion={quat}>
      <circleGeometry args={[inner, 24]} />
      <meshStandardMaterial color={night ? '#0c0e12' : '#3a3d44'} roughness={0.9} side={2} />
    </mesh>
  );
}
