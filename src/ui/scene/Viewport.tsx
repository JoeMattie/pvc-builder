import { Canvas } from '@react-three/fiber';
import { Scene } from './Scene';

// The 3D viewport host (planfile §6): orthographic isometric by default,
// one-toggle perspective, free orbit/pan/zoom, an axis-triad gizmo, a ground
// grid, and PBR pipe. All scene contents live in <Scene/>.
export function Viewport() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene />
    </Canvas>
  );
}
