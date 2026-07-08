import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { DrawController } from './DrawController';
import { PipeLayer } from './PipeLayer';
import { SelectionHandles } from './SelectionHandles';

// Looking down the (1,1,1) diagonal gives the classic isometric three-quarter
// view. Same heading for both cameras so toggling projection doesn't jump.
// Distance + ortho zoom are tuned to frame ~4 m of ground on a typical
// viewport — pipe-scale work (0.3–2 m) reads clearly without zooming in, and
// the perspective camera's framing at this distance matches the ortho zoom so
// the projection toggle doesn't jump scale.
const ISO_DIR: [number, number, number] = [3.2, 3.2, 3.2];
const ORTHO_ZOOM = 230;

/** Everything inside the Canvas: camera, studio lighting, ground grid + shadow
 * catcher, pipe meshes, the draw controller, and selection drag handles. */
export function Scene() {
  // Scene deliberately does NOT subscribe to the design document — the pipe and
  // handle layers read it themselves. That keeps a drag (which mutates the doc
  // every frame) from re-rendering the grid, gizmo, cameras, and lights.
  const projection = useEditorStore((s) => s.projection);
  const tool = useEditorStore((s) => s.tool);
  const night = useThemeStore((s) => s.night);
  const pal = scenePalette(night);

  return (
    <>
      <color attach="background" args={[pal.viewport]} />

      {projection === 'ortho' ? (
        <OrthographicCamera
          makeDefault
          position={ISO_DIR}
          zoom={ORTHO_ZOOM}
          near={-100}
          far={100}
        />
      ) : (
        <PerspectiveCamera makeDefault position={ISO_DIR} fov={40} near={0.01} far={1000} />
      )}

      <ambientLight intensity={0.65} />
      <hemisphereLight intensity={0.35} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
      />

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

      <PipeLayer />

      {/* ground-plane pointer target + shadow catcher + draw preview */}
      <DrawController />

      {/* endpoint drag handles for the selected member */}
      {tool === 'select' && <SelectionHandles />}

      <OrbitControls key={projection} makeDefault enableDamping target={[0, 0, 0]} />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#d64545', '#3d9950', '#2a78d6']} labelColor="#fff" />
      </GizmoHelper>
    </>
  );
}
