// Renders the static human MANNEQUIN (schema v9 `design.mannequin`): the SAME
// simple primitives the physics build collides against (`mannequinShapes()`),
// drawn as a semi-transparent neutral-gray body so the user sees where to mount
// the design. Shown in BOTH edit and Play. Not interactive (pointer-events off),
// and static — the shapes are read once, no per-frame easing.
import { type MannequinShape, mannequinShapes } from '../../design/mannequin';
import { useAppStore } from '../../state/appStore';
import { placeAxis } from './axis';

const BODY_COLOR = '#9aa1ab';

function ShapeMesh({ s }: { s: MannequinShape }) {
  const material = (
    <meshStandardMaterial
      color={BODY_COLOR}
      roughness={0.85}
      metalness={0.05}
      transparent
      opacity={0.4}
      depthWrite={false}
    />
  );
  if (s.kind === 'sphere') {
    return (
      <mesh position={[s.center.x, s.center.y, s.center.z]}>
        <sphereGeometry args={[s.r, 20, 16]} />
        {material}
      </mesh>
    );
  }
  if (s.kind === 'box') {
    return (
      <mesh position={[s.center.x, s.center.y, s.center.z]}>
        <boxGeometry args={[s.half.x * 2, s.half.y * 2, s.half.z * 2]} />
        {material}
      </mesh>
    );
  }
  const placed = placeAxis(s.a, s.b);
  if (!placed) return null;
  // capsuleGeometry is along +Y (placeAxis orients Y along the segment); the
  // cylinder part is the endpoint span minus the two hemispherical caps.
  const cyl = Math.max(placed.len - 2 * s.r, 0.001);
  return (
    <mesh position={placed.mid} quaternion={placed.quat}>
      <capsuleGeometry args={[s.r, cyl, 6, 14]} />
      {material}
    </mesh>
  );
}

export function MannequinLayer() {
  const on = useAppStore((s) => s.current?.mannequin ?? false);
  if (!on) return null;
  return (
    <group>
      {mannequinShapes().map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed static shape list
        <ShapeMesh key={i} s={s} />
      ))}
    </group>
  );
}
