// Renders a heat-wrap slip-saddle fitting (the composed primitives from
// buildWrapMesh) as a molded PVC body: collar sleeve + branch socket boss +
// blend, plus optional set-screw discs. Shared by WrapLayer (tee wraps) and
// PivotLayer (pivot joints rendered as wrapped swivels).
import type { ThreeEvent } from '@react-three/fiber';
import { orientY, placeAxis } from './axis';
import type { WrapCyl, WrapMesh } from './wrapMesh';

const SCREW_COLOR = '#4b5563'; // steel set screw

function Cyl({
  c,
  color,
  onClick,
}: {
  c: WrapCyl;
  color: string;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const placed = placeAxis(c.a, c.b);
  if (!placed) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node, not a DOM element
    <mesh position={placed.mid} quaternion={placed.quat} castShadow onClick={onClick}>
      <cylinderGeometry args={[c.radiusM, c.radiusM, placed.len, 24]} />
      <meshPhysicalMaterial color={color} roughness={0.4} metalness={0} clearcoat={0.45} />
    </mesh>
  );
}

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
  const bodyColor = selected ? '#2a78d6' : color;
  return (
    <group>
      {mesh.prims.map((p, i) =>
        p.kind === 'cylinder' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
          <Cyl key={i} c={p} color={bodyColor} onClick={onClick} />
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a scene node, not a DOM element
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
            key={i}
            position={[p.center.x, p.center.y, p.center.z]}
            castShadow
            onClick={onClick}
          >
            <sphereGeometry args={[p.radiusM, 24, 18]} />
            <meshPhysicalMaterial
              color={bodyColor}
              roughness={0.4}
              metalness={0}
              clearcoat={0.45}
            />
          </mesh>
        ),
      )}
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
