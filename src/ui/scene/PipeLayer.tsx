// r3f renderer for the pipe model: PBR cylinders at true OD with a faint
// clearcoat so white PVC reads as plastic (planfile §6), plus a hollow bore at
// each free pipe end so pipes read as real tube with wall thickness. In the
// select tool, clicking a pipe selects its member.
import type { ThreeEvent } from '@react-three/fiber';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { selectMember } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { orientZ, placeAxis } from './axis';
import { buildPipeModel, type PipeCylinder, type PipeEnd } from './pipeModel';

const RADIAL_SEGMENTS = 20;

function Pipe({
  cyl,
  color,
  selected,
  onSelect,
}: {
  cyl: PipeCylinder;
  color: string;
  selected: boolean;
  onSelect?: (memberId: string) => void;
}) {
  const placed = placeAxis(cyl.a, cyl.b);
  if (!placed) return null;
  const click = onSelect
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(cyl.memberId);
      }
    : undefined;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a three.js scene node, not a DOM element — the a11y rule does not apply
    <mesh position={placed.mid} quaternion={placed.quat} onClick={click} castShadow receiveShadow>
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
  const night = useThemeStore((s) => s.night);
  // re-render while geometry is easing toward its snapped target (reads the
  // mutable eased-position map, so it recomputes each animating frame)
  useAnim((s) => s.v);
  const color = scenePalette(night).pvc;
  const model = design ? buildPipeModel(design, easedPos) : null;
  if (!model) return null;
  // click-to-select works in the select / move / rotate tools (so you can pick
  // the pipe to transform without leaving the gizmo)
  const onSelect =
    tool === 'select' || tool === 'move' || tool === 'rotate' ? selectMember : undefined;
  const selected = new Set(selectedIds);

  return (
    <>
      {model.cylinders.map((c) => (
        <Pipe
          key={c.memberId}
          cyl={c}
          color={color}
          selected={selected.has(c.memberId)}
          onSelect={onSelect}
        />
      ))}
      {model.ends.map((e) => (
        <Bore key={e.nodeId} end={e} night={night} />
      ))}
    </>
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
