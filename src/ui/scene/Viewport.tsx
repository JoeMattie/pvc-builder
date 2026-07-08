import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';

// The 3D viewport (planfile §6): orthographic isometric by default, one-toggle
// perspective, free orbit/pan/zoom, an axis-triad gizmo, and a ground grid.
// Phase 0 renders an empty stage; pipe/fitting layers arrive in later phases.

// Looking down the (1,1,1) diagonal gives the classic isometric three-quarter
// view. Same heading for both cameras so toggling projection doesn't jump.
const ISO_DIR: [number, number, number] = [10, 10, 10];

function Stage() {
  const projection = useEditorStore((s) => s.projection);
  const night = useThemeStore((s) => s.night);
  const pal = scenePalette(night);

  return (
    <>
      <color attach="background" args={[pal.viewport]} />

      {projection === 'ortho' ? (
        <OrthographicCamera makeDefault position={ISO_DIR} zoom={90} near={-100} far={100} />
      ) : (
        <PerspectiveCamera makeDefault position={ISO_DIR} fov={40} near={0.01} far={1000} />
      )}

      <ambientLight intensity={0.7} />
      <hemisphereLight intensity={0.35} />
      <directionalLight position={[6, 12, 8]} intensity={1.1} castShadow />

      <Grid
        args={[40, 40]}
        infiniteGrid
        cellSize={0.1}
        cellThickness={0.6}
        cellColor={pal.gridCell}
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor={pal.gridSection}
        fadeDistance={30}
        fadeStrength={1.5}
        followCamera={false}
      />

      {/* re-key so OrbitControls re-attaches to the newly-default camera */}
      <OrbitControls key={projection} makeDefault enableDamping target={[0, 0, 0]} />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#d64545', '#3d9950', '#2a78d6']} labelColor="#fff" />
      </GizmoHelper>
    </>
  );
}

export function Viewport() {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ position: 'absolute', inset: 0 }}
      shadows
    >
      <Stage />
    </Canvas>
  );
}
