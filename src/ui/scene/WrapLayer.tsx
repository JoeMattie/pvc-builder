// Renders heat-wrapped tees (planfile §4): the branch's flattened PVC strip
// wrapped ONCE, smoothly, around the intact through pipe — a rectangular
// cross-section swept along a single-turn helix (a triangle mesh from the pure
// `buildWrapMesh`). Rigid wraps get steel screw discs at the seam; a pivot wrap
// is tinted the accent (the hinge barrel about the run). Placed at eased render
// positions so it glides with the pipe; clicking it selects the branch (its
// inspector carries the rigid/pivot toggle).
import type { ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import { type BufferGeometry, Float32BufferAttribute } from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { normalize, sub } from '../../geometry/math3';
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

function WrapMesh({
  wrap,
  selectable,
  selected,
}: {
  wrap: Wrap;
  selectable: boolean;
  selected: boolean;
}) {
  const geoRef = useRef<BufferGeometry>(null);
  const design = useAppStore.getState().current;
  const eased = (id: string): Vec3 => {
    if (!design) return { x: 0, y: 0, z: 0 };
    return easedPos(id) ?? nodeById(design, id)?.position ?? { x: 0, y: 0, z: 0 };
  };

  const through = design ? memberById(design, wrap.throughMember) : undefined;
  const branch = design?.members.find(
    (m) => m.nodeA === wrap.branchNode || m.nodeB === wrap.branchNode,
  );

  const mesh =
    design && through?.kind === 'straight' && branch
      ? buildWrapMesh({
          through: {
            a: eased(through.nodeA),
            b: eased(through.nodeB),
            odM: pipeSpec(through.size).odM,
          },
          wrapPoint: eased(wrap.branchNode),
          branchDir: normalize(
            sub(
              eased(branch.nodeA === wrap.branchNode ? branch.nodeB : branch.nodeA),
              eased(wrap.branchNode),
            ),
          ),
          branchODM: pipeSpec(branch.size).odM,
          rigid: wrap.rigid,
        })
      : null;

  // rebuild the strip geometry each render (it eases with the pipe); the
  // <bufferGeometry> object is created once by r3f and reused (no per-frame leak)
  useLayoutEffect(() => {
    const g = geoRef.current;
    if (!g || !mesh) return;
    g.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
    g.setIndex(mesh.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
  });

  if (!design || !mesh || !branch) return null;
  const night = useThemeStore.getState().night;
  const pal = scenePalette(night);
  const onSelect = selectable
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        selectMember(branch.id);
      }
    : undefined;
  // rigid = white PVC + screws; pivot = accent-tinted hinge barrel, no screws
  const strapColor = wrap.rigid ? pal.pvc : pal.accent;

  return (
    <group>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node, not a DOM element */}
      <mesh castShadow onClick={onSelect}>
        <bufferGeometry ref={geoRef} />
        <meshPhysicalMaterial
          color={strapColor}
          roughness={0.42}
          clearcoat={0.35}
          side={2}
          emissive={selected ? '#2a78d6' : '#000000'}
          emissiveIntensity={selected ? 0.3 : 0}
        />
      </mesh>

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
