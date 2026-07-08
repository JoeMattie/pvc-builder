// r3f renderer for the pipe model: PBR cylinders at true OD with a faint
// clearcoat so white PVC reads as plastic (planfile §6), plus rounding spheres
// at junctions. In the select tool, clicking a pipe selects its member.
import type { ThreeEvent } from '@react-three/fiber';
import type { Design } from '../../schema';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { placeAxis } from './axis';
import { buildPipeModel, type PipeCylinder } from './pipeModel';

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

export function PipeLayer({
  design,
  selectedIds,
  onSelect,
}: {
  design: Design;
  selectedIds: string[];
  /** provided only when the select tool is active (enables click-to-select) */
  onSelect?: (memberId: string) => void;
}) {
  const night = useThemeStore((s) => s.night);
  const color = scenePalette(night).pvc;
  const model = buildPipeModel(design);
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
      {model.joints.map((j) => (
        <mesh
          key={j.nodeId}
          position={[j.center.x, j.center.y, j.center.z]}
          castShadow
          receiveShadow
        >
          <sphereGeometry args={[j.radiusM, 18, 14]} />
          <meshPhysicalMaterial
            color={color}
            roughness={0.38}
            metalness={0}
            clearcoat={0.6}
            clearcoatRoughness={0.35}
          />
        </mesh>
      ))}
    </>
  );
}
