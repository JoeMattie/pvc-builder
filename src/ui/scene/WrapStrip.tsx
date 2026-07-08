// Renders a heat-wrap strip (the smooth single-turn helix from buildWrapMesh) as
// a reusable r3f mesh: one <bufferGeometry> object created once by r3f and
// refilled each eased frame (position + computeVertexNormals) so it glides
// without leaking geometry. Shared by WrapLayer (tee wraps) and PivotLayer
// (pivot joints rendered as wrapped swivels).
import type { ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import { type BufferGeometry, Float32BufferAttribute } from 'three';
import { orientY } from './axis';
import type { WrapMesh } from './wrapMesh';

const SCREW_COLOR = '#4b5563'; // steel screw head

export function WrapStrip({
  mesh,
  color,
  selected = false,
  onClick,
}: {
  mesh: WrapMesh;
  color: string;
  selected?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geoRef = useRef<BufferGeometry>(null);
  useLayoutEffect(() => {
    const g = geoRef.current;
    if (!g) return;
    g.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
    g.setIndex(mesh.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
  });
  return (
    <group>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node, not a DOM element */}
      <mesh castShadow onClick={onClick}>
        <bufferGeometry ref={geoRef} />
        <meshPhysicalMaterial
          color={color}
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
