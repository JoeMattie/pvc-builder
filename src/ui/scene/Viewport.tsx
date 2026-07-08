import { Canvas } from '@react-three/fiber';
import { Scene } from './Scene';

// The 3D viewport host (planfile §6): orthographic isometric by default,
// one-toggle perspective, free orbit/pan/zoom, an axis-triad gizmo, a ground
// grid, and PBR pipe. All scene contents live in <Scene/>.
export function Viewport() {
  return (
    <Canvas
      // 'soft' = PCFSoftShadowMap, which honours the light's shadow-radius for a
      // soft penumbra (PCFShadowMap ignores radius). three 0.185 may deprecation-
      // warn, but it's the cheap path to genuinely soft shadows.
      shadows="soft"
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene />
    </Canvas>
  );
}
