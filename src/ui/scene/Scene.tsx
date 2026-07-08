import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { MOUSE, Vector3 } from 'three';
import { bumpAnim, easedPos, stepEasing } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { DrawController } from './DrawController';
import { FittingLayer } from './FittingLayer';
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
      <FittingLayer />

      {/* ground-plane pointer target + shadow catcher + draw preview */}
      <DrawController />

      {/* endpoint drag handles for the selected member */}
      {tool === 'select' && <SelectionHandles />}

      {/* middle = pan, right = free rotate; left is reserved (drawing / select
          / future marquee), so it never orbits */}
      <OrbitControls
        key={projection}
        makeDefault
        enableDamping
        zoomToCursor
        target={[0, 0, 0]}
        mouseButtons={{ MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }}
      />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#d64545', '#3d9950', '#2a78d6']} labelColor="#fff" />
      </GizmoHelper>

      <GeometryAnimator />
      <VelocityZoom />
      <DebugBridge />
    </>
  );
}

/** Velocity-aware wheel zoom: scale OrbitControls' per-tick zoom step by how
 * fast the wheel is spinning, so a quick flick covers ground while a slow
 * scroll stays fine. Runs in the capture phase so the updated zoomSpeed is in
 * place before OrbitControls handles the same wheel event. */
function VelocityZoom() {
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { zoomSpeed: number } | null;
  useEffect(() => {
    if (!controls) return;
    const el = gl.domElement;
    const BASE = controls.zoomSpeed;
    let last = performance.now();
    let vel = 0; // smoothed wheel magnitude per ms
    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      const dt = Math.max(1, now - last);
      last = now;
      // fade prior velocity over ~130 ms, then add this tick's instantaneous
      // speed (bigger/faster deltas ⇒ more) so rapid flicks accumulate
      vel = vel * Math.exp(-dt / 130) + Math.abs(e.deltaY) / dt;
      controls.zoomSpeed = Math.min(5, Math.max(0.6, 0.7 + vel * 0.9));
    };
    el.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      controls.zoomSpeed = BASE;
    };
  }, [gl, controls]);
  return null;
}

// Ease at ~40 ms time-constant; skip animation past this many nodes (e.g. the
// T-rex) so large designs never pay per-frame re-renders.
const EASE_TAU = 0.045;
const MAX_ANIMATED_NODES = 160;

/** Drives the eased render positions once per frame (see state/animStore). */
function GeometryAnimator() {
  useFrame((_, dt) => {
    const design = useAppStore.getState().current;
    if (!design) return;
    const instant = design.nodes.length > MAX_ANIMATED_NODES;
    const alpha = Math.min(1, 1 - Math.exp(-dt / EASE_TAU));
    if (stepEasing(design.nodes, alpha, instant)) bumpAnim();
  });
  return null;
}

/** Publishes camera / controls / projection seams onto window.__pvc so scripted
 * checks can verify the viewport (e.g. that a handle drag doesn't leave
 * OrbitControls disabled). No-op for real users. */
function DebugBridge() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  useEffect(() => {
    const w = window as unknown as { __pvc?: Record<string, unknown> };
    if (!w.__pvc) w.__pvc = {};
    w.__pvc.getCameraPos = () => ({
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    });
    w.__pvc.isControlsEnabled = () => (controls ? controls.enabled : null);
    w.__pvc.getEasedPos = (id: string) => easedPos(id) ?? null;
    // orthographic zoom factor (rises as you zoom in) — for verifying wheel zoom
    w.__pvc.getZoom = () => (camera as { zoom?: number }).zoom ?? null;
    w.__pvc.screenOf = (p: { x: number; y: number; z: number }) => {
      const rect = gl.domElement.getBoundingClientRect();
      const v = new Vector3(p.x, p.y, p.z).project(camera);
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      };
    };
  });
  return null;
}
