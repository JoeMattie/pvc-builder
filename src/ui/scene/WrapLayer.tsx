// Renders heat-wrapped tees (planfile §4): the branch's flattened, rectangular
// PVC strip wrapped around the intact through pipe — a faceted band of flat
// boxes bent around the run — with screw discs for rigid wraps or the hinge
// axis exposed for a natural pivot. Geometry comes from the pure `buildWrapMesh`
// placed at eased render positions so it glides with the pipe; clicking the
// strap selects the branch (its inspector carries the rigid/pivot toggle).
import type { ThreeEvent } from '@react-three/fiber';
import { Quaternion as ThreeQuat } from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { normalize, quatFromBasis, sub } from '../../geometry/math3';
import { pipeSpec, type Vec3, type Wrap } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { selectMember } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { orientY } from './axis';
import { buildWrapMesh } from './wrapMesh';

/** Skip past this many members (matches the fitting layer). */
const MAX_WRAP_MEMBERS = 200;
const SCREW_COLOR = '#4b5563'; // steel screw head

function quat(x: Vec3, y: Vec3, z: Vec3): ThreeQuat {
  const q = quatFromBasis(x, y, z);
  return new ThreeQuat(q.x, q.y, q.z, q.w);
}

function WrapMesh({
  wrap,
  selectable,
  selected,
}: {
  wrap: Wrap;
  selectable: boolean;
  selected: boolean;
}) {
  const design = useAppStore.getState().current;
  if (!design) return null;
  const eased = (id: string): Vec3 =>
    easedPos(id) ?? nodeById(design, id)?.position ?? { x: 0, y: 0, z: 0 };

  const through = memberById(design, wrap.throughMember);
  if (through?.kind !== 'straight') return null;
  // the branch member is whatever else meets the wrap's branch node
  const branch = design.members.find(
    (m) => m.nodeA === wrap.branchNode || m.nodeB === wrap.branchNode,
  );
  if (!branch) return null; // lone wrap node (branch not drawn yet) — nothing to show
  const far = branch.nodeA === wrap.branchNode ? branch.nodeB : branch.nodeA;

  const wrapPoint = eased(wrap.branchNode);
  const branchDir = normalize(sub(eased(far), wrapPoint));
  const night = useThemeStore.getState().night;
  const pal = scenePalette(night);

  const mesh = buildWrapMesh({
    through: { a: eased(through.nodeA), b: eased(through.nodeB), odM: pipeSpec(through.size).odM },
    wrapPoint,
    branchDir,
    branchODM: pipeSpec(branch.size).odM,
    rigid: wrap.rigid,
  });
  if (!mesh) return null;

  // in the select tool, clicking the strap selects the branch (whose inspector
  // carries the rigid/pivot toggle); other tools let the click fall through
  const onSelect = selectable
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        selectMember(branch.id);
      }
    : undefined;
  // rigid wraps are white PVC + steel screws; a pivot wrap tints the strap
  // toward the accent (the hinge barrel around the run) and drops the screws
  const strapColor = wrap.rigid ? pal.pvc : pal.accent;

  return (
    <group>
      {mesh.facets.map((f, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node, not a DOM element
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: facets are positional per wrap
          key={i}
          position={[f.center.x, f.center.y, f.center.z]}
          quaternion={quat(f.lengthDir, f.widthDir, f.thickDir)}
          castShadow
          onClick={onSelect}
        >
          <boxGeometry args={f.size} />
          <meshPhysicalMaterial
            color={strapColor}
            roughness={0.42}
            clearcoat={0.35}
            emissive={selected ? '#2a78d6' : '#000000'}
            emissiveIntensity={selected ? 0.3 : 0}
          />
        </mesh>
      ))}

      {mesh.screws.map((s, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: screws are positional per wrap
          key={`s${i}`}
          position={[s.center.x, s.center.y, s.center.z]}
          quaternion={orientY(s.normal)}
        >
          <cylinderGeometry args={[s.radiusM, s.radiusM, 0.004, 16]} />
          <meshStandardMaterial color={SCREW_COLOR} roughness={0.35} metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function WrapLayer() {
  useAnim((s) => s.v); // re-render while easing so wraps track the pipe
  const design = useAppStore((s) => s.current);
  const tool = useEditorStore((s) => s.tool);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  if (!design || design.members.length > MAX_WRAP_MEMBERS) return null;
  const selectable = tool === 'select';
  const isSelected = (w: Wrap) => {
    const branch = design.members.find((m) => m.nodeA === w.branchNode || m.nodeB === w.branchNode);
    return !!branch && selectedIds.includes(branch.id);
  };
  return (
    <>
      {design.wraps.map((w) => (
        <WrapMesh key={w.id} wrap={w} selectable={selectable} selected={isSelected(w)} />
      ))}
    </>
  );
}
